import 'dotenv/config';
import fs from 'fs-extra';
import path from 'path';
import ignore from 'ignore';
import archiver from 'archiver';
import ftp from 'basic-ftp';
import { execa } from 'execa';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import gulp from 'gulp';
import javascriptObfuscator from 'gulp-javascript-obfuscator';
import { promisify } from 'util';
import { glob } from 'glob';
import fg from 'fast-glob';
import mysql from 'mysql2/promise';
import pg from 'pg'; 
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

class App {
	constructor(options = {}) {
		// Promisify glob as instance method
		this.globPromise = promisify(glob);

		// Path helpers as instance properties
		this.ROOT = process.cwd();

		this.options = {
			// Deployment options
			deploy: false,
			secure: false,
			verbose: false,

			// Obfuscation options
			obfuscateJs: false,
			obfuscatePhp: false,
			onlyObfuscate: false,
			preserveOriginal: false,

			// Path options
			jsSrcPath: 'public/js',
			jsDestPath: 'public/orig',

			// Domain lock options
			domainLock: [],
			domainLockRedirectUrl: '',

			// Development options
			generate_controllers: false,
			controllers: [],

			// Stats
			total: null,
			included: null,
			excluded: null, 

			...options
		};
	}

	/** 
	 * CONFIGURATION METHODS
	*/
	async loadConfig() {
		const configPath = path.join(this.ROOT, '.xfixrc.json');

		if (!(await fs.pathExists(configPath))) {
			throw new Error('❌ Configuration file .xfixrc.json not found in project root');
		}

		const config = await fs.readJson(configPath);

		return {
			host: config.host,
			username: config.username,
			password: process.env.DEPLOY_PASSWORD || config.password,
			remotePath: config.remotePath,
			deployPath: config.deployPath,
			branch: config.branch || 'develop',
			version: config.version || process.env.APP_VERSION || '',
			deployUrl: config.deployUrl ? config.deployUrl + '/v1/api/deploy' : null,
			secure: this.options.secure || config.secure || false,
			rejectUnauthorized: config.rejectUnauthorized || false,
			maxRetries: config.maxRetries || 3,
			retryDelay: config.retryDelay || 2000,
			allowBackup: config.allowBackup || false,
			cleanupLocal: config.cleanupLocal || false,
			runMigrations: config.runMigrations || false,
			clearCache: config.clearCache || false,
			runComposer: config.runComposer || false,
			verbose: this.options.verbose || config.verbose || false,
			clientId: config.clientId || process.env.CLIENT_ID || process.env.XFIX_CLIENT_ID,
			apiKey: config.apiKey || process.env.API_KEY || process.env.XFIX_API_KEY,

			// Obfuscation settings
			obfuscateJs: this.options.obfuscateJs || config.obfuscateJs || false,
			obfuscatePhp: this.options.obfuscatePhp || config.obfuscatePhp || false,
			jsSrcPath: this.options.jsSrcPath || config.jsSrcPath || 'public/js',
			jsDestPath: this.options.jsDestPath || config.jsDestPath || 'public/orig',
			preserveOriginal: this.options.preserveOriginal ?
				(config.preserveOriginal || 'public/original_js_asset_folder') :
				null,

			// Domain lock settings
			domainLock: this.options.domainLock && this.options.domainLock.length > 0 ?
				this.options.domainLock :
				(config.domainLock || [
					'http://localhost',
					'http://127.0.0.1'
				]),
			domainLockRedirectUrl: this.options.domainLockRedirectUrl ||
				config.domainLockRedirectUrl ||
				'http://localhost',

			// Database configurations
			databaseHost: config.databaseHost || process.env.DB_HOST || 'localhost',
			databaseUser: config.databaseUser || process.env.DB_USER || 'root',
			databasePassword: config.databasePassword || process.env.DB_PASSWORD || '',
			databaseName: config.databaseName || process.env.DB_NAME || 'xfix_db',
			databasePort: config.databasePort || parseInt(process.env.DB_PORT || '3306'),
			waitDatabaseForConnections: config.waitDatabaseForConnections || true,
			databaseConnectionLimit: config.databaseConnectionLimit || 10,
			databaseQueueLimit: config.databaseQueueLimit || 0
		};
	}

	validateConfig(config) {
		const required = ['host', 'username', 'password', 'remotePath', 'deployPath'];
		const missing = required.filter(key => !config[key]);

		if (missing.length) {
			throw new Error(
				`❌ Missing required configuration fields: ${missing.join(', ')}`
			);
		}

		if (config.password === 'your-password-here') {
			throw new Error(
				'❌ Please update the default password in .xfixrc.json or set DEPLOY_PASSWORD environment variable'
			);
		}
	}

	/** 
	 * FILE & IGNORE METHODS
	*/
	loadIgnore() {
		const ig = ignore();
		const ignoreFile = path.join(this.ROOT, '.updateignore');

		if (fs.existsSync(ignoreFile)) {
			const content = fs.readFileSync(ignoreFile, 'utf-8');
			ig.add(content.split('\n').filter(line => line.trim() && !line.startsWith('#')));
		}

		// Always ignore these files
		ig.add([
			'.git',
			'.updateignore',
			'.xfixrc.json', 
			'deploy.zip',
			'.DS_Store',
			'Thumbs.db',
			'obfuscated',
			'public/orig',
			'public/original_js_asset_folder',
			'vendor/**/[..*',           // Catches: vendor/../[..anything].ext
			'vendor/**/[..*.*',         // Catches: vendor/../[..anything].astro, .ts, etc.
			'vendor/**/[...*',           // Catches: vendor/.../[...anything].ext
			'vendor/**/[...*.*',         // Catches: vendor/.../[...anything].astro, .ts, etc.
		]);

		return ig;
	}

	async getAllFiles(dir = this.ROOT, depth = 0, maxDepth = 50) {
		if (depth > maxDepth) {
			throw new Error(`❌ Maximum directory depth (${maxDepth}) exceeded at: ${dir}`);
		}

		const entries = await fs.readdir(dir, {
			withFileTypes: true
		});

		const files = await Promise.all(
			entries.map(async (entry) => {
				const fullPath = path.join(dir, entry.name);

				if (entry.isDirectory()) {
					return this.getAllFiles(fullPath, depth + 1, maxDepth);
				}

				return fullPath;
			})
		);

		return files.flat();
	}

	filterFiles(files, ig, config) {
		const filtered = files.filter((file) => {
			const rel = path.relative(this.ROOT, file);
			const isIgnored = ig.ignores(rel);

			if (config.verbose && isIgnored) {
				console.log(`  ⏭️  Ignored: ${rel}`);
			}

			return !isIgnored;
		});

		this.options.total = files.length;
		this.options.included = filtered.length;
		this.options.excluded = files.length - filtered.length;

		return {
			files: filtered,
			stats: {
				total: files.length,
				included: filtered.length,
				excluded: files.length - filtered.length
			}
		};
	}

	/** 
	 * ARCHIVE METHODS
	*/
	async createArchive(zipPath, files, config) {
		return new Promise((resolve, reject) => {
			const output = fs.createWriteStream(zipPath);
			const archive = archiver('zip', {
				zlib: {
					level: 9
				}
			});

			let processedFiles = 0;
			const totalFiles = files.length;

			output.on('close', () => {
				const sizeInMB = (archive.pointer() / (1024 * 1024)).toFixed(2);
				console.log(`✅  Archive created (${sizeInMB} MB, ${processedFiles} files)`);
				resolve();
			});

			archive.on('error', reject);
			output.on('error', reject);

			archive.on('progress', (progress) => {
				if (progress.entries && progress.entries.processed > processedFiles) {
					processedFiles = progress.entries.processed;
					if (config.verbose) {
						console.log(`  📦 Adding: ${processedFiles}/${totalFiles} files`);
					}
				}
			});

			archive.pipe(output);

			for (const file of files) {
				const relative = path.relative(this.ROOT, file);
				archive.file(file, {
					name: relative
				});
			}

			archive.finalize();
		});
	}

	/** 
	 * DEPLOYMENT METHODS
	*/
	async validateBranch(expectedBranch) {
		try {
			const {
				stdout: branch
			} = await execa('git', [
				'rev-parse',
				'--abbrev-ref',
				'HEAD'
			]);

			const currentBranch = branch.trim();

			if (currentBranch !== expectedBranch) {
				throw new Error(
					`❌ Branch mismatch. Expected "${expectedBranch}", but currently on "${currentBranch}"`
				);
			}

			console.log(`✅  Branch verified: ${currentBranch}`);
			return currentBranch;
		} catch (error) {
			if (error.message.includes('Branch mismatch')) {
				throw error;
			}
			throw new Error('❌ Failed to validate git branch. Are you in a git repository?');
		}
	}

	async uploadWithRetry(client, localPath, remotePath, config) {
		let lastError;

		for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
			try {
				console.log(`📤  Upload attempt ${attempt}/${config.maxRetries}...`);

				await client.uploadFrom(localPath, remotePath);

				console.log('✅  Upload complete');
				return;
			} catch (error) {
				lastError = error;

				if (attempt < config.maxRetries) {
					console.log(`  🚫 Upload attempt ${attempt} failed, retrying in ${config.retryDelay/1000}s...`);
					await new Promise(resolve => setTimeout(resolve, config.retryDelay));
				}
			}
		}

		throw new Error(`❌ Upload failed after ${config.maxRetries} attempts: ${lastError.message}`);
	}

	async triggerDeploymentStaging(deployUrl, config) {
		if (!deployUrl) {
			console.log('🚫  No deployUrl configured, skipping remote deployment staging');
			return;
		}

		console.log('🛠️  Triggering remote deployment staging...');

		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 300000);

			const formData = new URLSearchParams();
			Object.entries(config).forEach(([key, value]) => {
				if (value !== undefined && value !== null) {
					if (typeof value === 'object') {
						formData.append(key, JSON.stringify(value));
					} else {
						formData.append(key, String(value));
					}
				}
			});

			const res = await fetch(deployUrl, {
				method: 'POST',
				signal: controller.signal,
				body: formData,
				headers: {
					'User-Agent': 'XFIX-Deploy/1.0',
					'Content-Type': 'application/x-www-form-urlencoded',
					'X-API-Key': config.apiKey,
					'XFIX-CLIENT-ID': config.clientId
				}
			});

			clearTimeout(timeout);

			if (!res.ok) {
				const errorText = await res.text();
				throw new Error(`HTTP ${res.status}: ${res.statusText} - ${errorText}`);
			}

			const responseData = await res.json();

			if (responseData.success) {
				console.log('✅  Remote deployment staging triggered successfully');
				console.log(`    Files deployed: ${this.options.included || 'N/A'}`);
				console.log(`    Version: ${config?.version || 'N/A'}`);
			} else {
				throw new Error(responseData.message || 'Unknown deployment error');
			}

		} catch (error) {
			if (error.name === 'AbortError') {
				throw new Error('❌ Remote deployment staging request timed out after 5 minutes');
			}
			throw new Error(`❌ Remote deployment staging failed: ${error.message}`);
		}
	}

	async cleanup(zipPath, config) {
		if (config.cleanupLocal && await fs.pathExists(zipPath)) {
			await fs.remove(zipPath);
			console.log('🧹 Cleanup complete');
		}
	}

	/** 
	 * OBFUSCATION METHODS
	*/
	get_excluded_js_files() {
		return [
			'vendor.js',
			'init.js',
			'icons.min.js',
			'jquery.min.js',
			'jquery-ui.min.js',
			'jquery.js',
			'jquery-ui.js'
		];
	}

	get_obfuscator_config(config) {
		// Merge domain lock from config with defaults
		const domainLock = config.domainLock || [
			'http://localhost',
			'http://127.0.0.1'
		];

		const domainLockRedirectUrl = config.domainLockRedirectUrl || 'http://localhost';

		return {
			compact: true,
			controlFlowFlattening: true,
			controlFlowFlatteningThreshold: 0.6,
			deadCodeInjection: true,
			deadCodeInjectionThreshold: 0.8,
			debugProtection: true,
			debugProtectionInterval: 2540,
			disableConsoleOutput: true,
			domainLock: domainLock,
			domainLockRedirectUrl: domainLockRedirectUrl,
			identifierNamesGenerator: 'hexadecimal',
			numbersToExpressions: true,
			optionsPreset: 'high-obfuscation',
			renameGlobals: false,
			renameProperties: false,
			selfDefending: true,
			simplify: true,
			seed: 4,
			stringArray: true,
			stringArrayCallsTransform: true,
			stringArrayCallsTransformThreshold: 0.8,
			stringArrayEncoding: [],
			stringArrayIndexesType: ['hexadecimal-numeric-string', 'hexadecimal-number'],
			stringArrayIndexShift: true,
			stringArrayRotate: true,
			stringArrayShuffle: true,
			stringArrayWrappersCount: 12,
			stringArrayWrappersChainedCalls: true,
			stringArrayWrappersParametersMaxCount: 3,
			stringArrayWrappersType: 'variable',
			stringArrayThreshold: 0.85,
			target: 'browser',
			transformObjectKeys: true,
			unicodeEscapeSequence: false
		};
	}

	async obfuscateJavaScript(srcPath, destPath, config) {
		console.log('\n🔒 Starting JavaScript obfuscation...');
		console.log(`   Source: ${srcPath}`);
		console.log(`   Destination: ${destPath}`);

		if (config.domainLock && config.domainLock.length > 0) {
			console.log(`   Domain Lock: ${config.domainLock.join(', ')}`);
			console.log(`   Redirect URL: ${config.domainLockRedirectUrl}`);
		}

		// Create destination directory if it doesn't exist
		await fs.ensureDir(destPath);

		// Preserve originals if requested
		if (config.preserveOriginal) {
			const preserveDir = config.preserveOriginal;
			if (fs.existsSync(srcPath)) {
				await this.copy_folder_recursive(srcPath, preserveDir);
				console.log(`   Original files preserved in: ${preserveDir}`);
			}
		}

		const exclude_files = this.get_excluded_js_files();
		const obfuscator_config = this.get_obfuscator_config(config);

		return new Promise((resolve, reject) => {
			// Create a glob pattern that excludes specific files
			const stream = gulp.src([
					`${srcPath}/**/*.js`,
					...exclude_files.map(f => `!${srcPath}/**/${f}`)
				])
				.pipe(javascriptObfuscator(obfuscator_config))
				.pipe(gulp.dest(destPath))
				.on('end', async () => {
					// Copy excluded files as-is
					await this.copy_excluded_js_files(srcPath, destPath, exclude_files);
					console.log('✅ JavaScript obfuscation completed');
					resolve();
				})
				.on('error', reject);
		});
	}

	async copy_excluded_js_files(srcPath, destPath, exclude_files) {
		for (const fileName of exclude_files) {
			const srcFile = path.join(srcPath, fileName);
			const destFile = path.join(destPath, fileName);

			if (fs.existsSync(srcFile)) {
				await fs.copyFile(srcFile, destFile);
				if (this.options.verbose) {
					console.log(`   Copied (excluded): ${fileName}`);
				}
			}
		}
	}

	async obfuscatePhp() {
		console.log('\n🔒 Starting PHP obfuscation...');

		// Check yakpro-po
		let yakproPath;
		try {
			yakproPath = execSync('which yakpro-po', {
				encoding: 'utf-8',
				stdio: 'pipe'
			}).trim();
			console.log(`   ✅ Using: ${yakproPath}`);
		} catch (error) {
			throw new Error('❌ yakpro-po is not installed.');
		}

		// Get ignore filter
		const ig = this.loadIgnore();

		// Scan for PHP files
		let phpFiles = [];

		try {
			phpFiles = await this.scan_php_files_with_ignore(ig);
			console.log(`   Found ${phpFiles.length} PHP files to obfuscate`);
		} catch (error) {
			console.error(`   ❌ File scan failed: ${error.message}`);
			return;
		}

		if (phpFiles.length === 0) {
			console.log('   ⚠️  No PHP files found to obfuscate');
			return;
		}

		// Process files
		let processed = 0;
		let failed = 0;
		const total = phpFiles.length;
		const startTime = Date.now();
		const failedFiles = [];

		// Obfuscate all files to obfuscated/ directory
		const batchSize = 5;

		for (let i = 0; i < phpFiles.length; i += batchSize) {
			const batch = phpFiles.slice(i, i + batchSize);

			for (const file of batch) {
				const sourcePath = path.join(this.ROOT, file);
				const outputFile = path.join(this.ROOT, 'obfuscated', file);
				const outputDir = path.dirname(outputFile);

				try {
					await fs.ensureDir(outputDir);

					const percent = Math.round(((processed + 1) / total) * 100);
					const displayFile = file.length > 40 ?
						'...' + file.substring(file.length - 37) :
						file;

					process.stdout.write(
						`\r   ⏳ [${processed + 1}/${total}] ${percent}% - ${displayFile.padEnd(40)}`
					);

					execSync(`"${yakproPath}" "${sourcePath}" -o "${outputFile}"`, {
						stdio: 'pipe',
						timeout: 60000
					});

					processed++;

				} catch (error) {
					failed++;
					failedFiles.push({
						file,
						error: error.message
					});
					continue;
				}
			}
		}

		const duration = ((Date.now() - startTime) / 1000).toFixed(2);

		// Clear progress line
		process.stdout.write('\r' + ' '.repeat(80) + '\r');

		// Show obfuscation summary
		console.log('');
		console.log(`✅ PHP obfuscation completed in ${duration}s`);
		console.log(`   ✅ Successfully processed: ${processed}/${total} files`);

		if (failed > 0) {
			console.log(`   ❌ Failed: ${failed} files`);
		}

		// REPLACE ORIGINAL FILES WITH OBFUSCATED ONES
		if (processed > 0) {
			console.log('\n🔄 Replacing original PHP files with obfuscated versions...');

			try {
				await this.replace_php_files(phpFiles, failedFiles);
				console.log('✅ PHP files replaced successfully');
			} catch (error) {
				console.error(`   ⚠️  Failed to replace files: ${error.message}`);
				console.log('   Obfuscated files are available in the "obfuscated/" directory');
			}
		}

		console.log('');
	}

	/**
	 * Replace original PHP files with obfuscated versions
	 * Creates a backup of originals first
	 */
	async replace_php_files(phpFiles, failedFiles) {
		const failedFileNames = new Set(failedFiles.map(f => f.file));
		const backupDir = path.join(this.ROOT, 'original_php_backup');

		console.log(`   Creating backup in: ${path.relative(this.ROOT, backupDir)}`);

		let replaced = 0;
		let backedUp = 0;

		for (const file of phpFiles) {
			// Skip files that failed obfuscation
			if (failedFileNames.has(file)) {
				continue;
			}

			const originalPath = path.join(this.ROOT, file);
			const obfuscatedPath = path.join(this.ROOT, 'obfuscated', file);
			const backupPath = path.join(backupDir, file);

			try {
				// Check if obfuscated file exists
				if (!fs.existsSync(obfuscatedPath)) {
					if (this.options.verbose) {
						console.log(`   ⚠️  Obfuscated file not found: ${file}`);
					}
					continue;
				}

				// Create backup directory
				await fs.ensureDir(path.dirname(backupPath));

				// Backup original file
				await fs.copyFile(originalPath, backupPath);
				backedUp++;

				// Replace original with obfuscated
				await fs.copyFile(obfuscatedPath, originalPath);
				replaced++;

				if (this.options.verbose && replaced % 50 === 0) {
					console.log(`   Replaced: ${replaced} files`);
				}

			} catch (error) {
				if (this.options.verbose) {
					console.error(`   ⚠️  Failed to replace ${file}: ${error.message}`);
				}
			}
		}

		console.log(`   ✅ Backed up: ${backedUp} original files`);
		console.log(`   ✅ Replaced: ${replaced} files with obfuscated versions`);

		// Clean up obfuscated directory after successful replacement
		if (replaced > 0) {
			try {
				await fs.remove(path.join(this.ROOT, 'obfuscated'));
				console.log('   🧹 Cleaned up obfuscated/ directory');
			} catch (error) {
				if (this.options.verbose) {
					console.log(`   ⚠️  Could not clean up obfuscated/ directory`);
				}
			}
		}
	}

	/**
	 * Revert PHP files back to originals from backup
	 */
	async revert_php_obfuscation() {
		const backupDir = path.join(this.ROOT, 'original_php_backup');

		if (!fs.existsSync(backupDir)) {
			console.log('⚠️  No backup found. Nothing to revert.');
			return;
		}

		console.log('\n🔄 Reverting PHP files to original versions...');

		const ig = this.loadIgnore();
		const phpFiles = await this.scan_php_files_with_ignore(ig);

		let reverted = 0;

		for (const file of phpFiles) {
			const originalPath = path.join(this.ROOT, file);
			const backupPath = path.join(backupDir, file);

			if (fs.existsSync(backupPath)) {
				try {
					await fs.copyFile(backupPath, originalPath);
					reverted++;
				} catch (error) {
					if (this.options.verbose) {
						console.error(`   ⚠️  Failed to revert ${file}: ${error.message}`);
					}
				}
			}
		}

		console.log(`✅ Reverted ${reverted} files`);

		// Clean up backup
		await fs.remove(backupDir);
		console.log('🧹 Cleaned up backup directory');
	}

	/**
	 * Scan PHP files manually using ignore rules
	 */
	async scan_php_files_with_ignore(ig) {
		const phpFiles = [];

		const scan = async (dir, relativePath = '') => {
			try {
				const entries = await fs.readdir(dir, {
					withFileTypes: true
				});

				for (const entry of entries) {
					const fullPath = path.join(dir, entry.name);
					const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

					// Normalize path separators for ignore matching
					const normalizedPath = relPath.replace(/\\/g, '/');

					// Check if path is ignored
					if (ig.ignores(normalizedPath)) {
						if (this.options.verbose) {
							console.log(`   ⏭️  Ignored: ${normalizedPath}`);
						}
						continue;
					}

					if (entry.isDirectory()) {
						await scan(fullPath, normalizedPath);
					} else if (entry.isFile() && entry.name.endsWith('.php')) {
						phpFiles.push(normalizedPath);
					}
				}
			} catch (error) {
				if (this.options.verbose) {
					console.error(`   ⚠️  Cannot access directory: ${dir} (${error.message})`);
				}
			}
		};

		await scan(this.ROOT);
		return phpFiles;
	}

	/**
	 * Revert PHP files back to originals from backup
	 */
	async revert_php_obfuscation() {
		const backupDir = path.join(this.ROOT, 'original_php_backup');

		if (!fs.existsSync(backupDir)) {
			console.log('⚠️  No PHP backup found. Nothing to revert.');
			return;
		}

		console.log('\n🔄 Reverting PHP files to original versions...');

		// Count backup files
		const backupFiles = await this.count_files_recursive(backupDir);
		console.log(`   Found ${backupFiles} backed up PHP files`);

		// Copy backup files back to original locations
		await this.copy_folder_recursive(backupDir, this.ROOT);

		console.log(`✅ Reverted ${backupFiles} PHP files`);

		// Clean up backup
		try {
			await fs.remove(backupDir);
			console.log('🧹 Cleaned up backup directory');
		} catch (error) {
			if (this.options.verbose) {
				console.log(`   ⚠️  Could not clean up backup directory: ${error.message}`);
			}
		}
	}

	/**
	 * Revert JavaScript files back to originals
	 */
	async revert_js_obfuscation() {
		const config = await this.loadConfig();
		const jsSrc = this.options.jsSrcPath || config.jsSrcPath || 'public/js';
		const jsDest = this.options.jsDestPath || config.jsDestPath || 'public/orig';
		const preserveDir = config.preserveOriginal || 'public/original_js_asset_folder';

		// Check if obfuscated version exists
		if (!fs.existsSync(jsDest)) {
			console.log('⚠️  No obfuscated JavaScript found. Nothing to revert.');
			return;
		}

		console.log('\n🔄 Reverting JavaScript files to original versions...');

		// If we have a backup, restore from it
		if (fs.existsSync(preserveDir)) {
			console.log(`   Restoring from backup: ${preserveDir}`);

			// Remove current obfuscated files
			if (fs.existsSync(jsSrc)) {
				await fs.remove(jsSrc);
			}

			// Restore original files
			await fs.ensureDir(jsSrc);
			await this.copy_folder_recursive(preserveDir, jsSrc);

			// Clean up backup
			await fs.remove(preserveDir);
			console.log('   🧹 Cleaned up backup directory');
		} else {
			// No backup, try swapping directories back
			if (fs.existsSync(jsDest)) {
				console.log('   Swapping directories back...');
				await this.rename_directories(jsDest, jsSrc);
			}
		}

		console.log('✅ JavaScript files reverted successfully');
	}

	/**
	 * Count files in a directory recursively
	 */
	async count_files_recursive(dir) {
		let count = 0;

		const scan = async (currentDir) => {
			const entries = await fs.readdir(currentDir, {
				withFileTypes: true
			});

			for (const entry of entries) {
				const fullPath = path.join(currentDir, entry.name);

				if (entry.isDirectory()) {
					await scan(fullPath);
				} else if (entry.isFile()) {
					count++;
				}
			}
		};

		await scan(dir);
		return count;
	}

	async rename_directories(srcPath, destPath) {
		if (!fs.existsSync(srcPath) || !fs.existsSync(destPath)) {
			console.warn('⚠️  Cannot swap directories: one or both paths do not exist');
			return;
		}

		const tempPath = path.join(path.dirname(srcPath), '__xfix_temp__');

		try {
			// Rename src directory to a temporary name
			await fs.move(srcPath, tempPath, {
				overwrite: true
			});

			// Rename dest directory to src directory name
			await fs.move(destPath, srcPath, {
				overwrite: true
			});

			// Rename temp directory to dest directory name
			await fs.move(tempPath, destPath, {
				overwrite: true
			});

			console.log('🔄 Directories swapped successfully');
		} catch (error) {
			console.error(`⚠️  Directory swap failed: ${error.message}`);

			// Attempt recovery
			try {
				if (fs.existsSync(tempPath)) {
					await fs.move(tempPath, srcPath, {
						overwrite: true
					});
				}
			} catch (recoveryError) {
				console.error(`⚠️  Recovery failed: ${recoveryError.message}`);
			}

			throw error;
		}
	}
	
	async generateControllers(controllers = []) {
		console.log('\n📝 Generating controllers...');

		const controllers_dir = path.join(this.ROOT, 'app', 'http', 'controllers');
		await fs.ensureDir(controllers_dir);

		let generated = 0;
		let existing = 0;

		for (const controller of controllers) {
			const controller_name = controller.charAt(0).toUpperCase() + controller.slice(1);
			const controller_file_name = controller_name + '.php';
			const controller_file_path = path.join(controllers_dir, controller_file_name);

			if (await fs.pathExists(controller_file_path)) {
				if (this.options.verbose) {
					console.log(`   ⏭️  Controller '${controller_name}' already exists`);
				}
				existing++;
				continue;
			}
			
			// Read the controller template 
			let templateContent = await this.templatesReader('partials/controllers/template.php');
			
			await fs.writeFile(controller_file_path, templateContent);
			console.log(`   ✅ Controller '${controller_name}' generated`);
			generated++;
		}

		console.log(`\n   Summary: ${generated} created, ${existing} already existed`);
		return {
			generated,
			existing
		};
	}
	
	/** 
	 * UTILITY METHODS
	*/
	async copy_folder_recursive(source, target) {
		if (!fs.existsSync(target)) {
			fs.mkdirSync(target, {
				recursive: true
			});
		}

		const items = fs.readdirSync(source);

		for (const item of items) {
			const source_path = path.join(source, item);
			const target_path = path.join(target, item);

			if (fs.lstatSync(source_path).isDirectory()) {
				await this.copy_folder_recursive(source_path, target_path);
			} else {
				await fs.copyFile(source_path, target_path);
			}
		}
	}
	
	/**
	 * Main deployment pipeline
	 */
	async deploy() {
		const start_time = Date.now();
		const config = await this.loadConfig();

		try {
			console.log('\n🚀 Starting XFIX deployment...\n');

			// Validate configuration
			this.validateConfig(config);

			// Create Services - Make services ready available in production
			this.createService({
				name: 'MigrationRunner',
				type: 'migration',
				verbose: this.options.verbose || false
			});

			// ============================================
			// PRE-DEPLOYMENT: Obfuscation
			// ============================================

			if (this.options.obfuscateJs || config.obfuscateJs) {
				const js_src = this.options.jsSrcPath || config.jsSrcPath || 'public/js';
				const js_dest = this.options.jsDestPath || config.jsDestPath || 'public/orig';

				if (!fs.existsSync(js_src)) {
					console.warn(`⚠️  JavaScript source directory not found: ${js_src}`);
					console.warn('   Skipping JS obfuscation');
				} else {
					await this.obfuscateJavaScript(js_src, js_dest, config);
					await this.rename_directories(js_src, js_dest);
				}
			}

			if (this.options.obfuscatePhp || config.obfuscatePhp) {
				await this.obfuscatePhp();
			}

			// ============================================
			// DEPLOYMENT PIPELINE
			// ============================================

			// Validate branch
			await this.validateBranch(config?.branch || 'main');

			// Scan and filter files
			console.log('\n📦 Scanning project files...');
			const ig = this.loadIgnore();
			const allFiles = await this.getAllFiles();
			const {
				files: allowedFiles,
				stats
			} = this.filterFiles(allFiles, ig, config);

			this.options.total = stats.total;
			this.options.included = stats.included;
			this.options.excluded = stats.excluded;

			console.log(`   Found ${stats.total} files: ${stats.included} included, ${stats.excluded} excluded`);

			if (!allowedFiles.length) {
				throw new Error('❌ No files to deploy. Check your .updateignore configuration.');
			}

			// Create archive
			const zip_path = path.join(this.ROOT, 'deploy.zip');
			console.log('\n📦 Creating archive...');
			await this.createArchive(zip_path, allowedFiles, config);

			// Upload to server
			console.log('\n🔗  Connecting to server...');
			const client = new ftp.Client();
			client.ftp.verbose = config.verbose;

			try {
				await client.access({
					host: config.host,
					user: config.username,
					password: config.password,
					secure: config.secure,
					secureOptions: config.secure ? {
						rejectUnauthorized: config.rejectUnauthorized
					} : undefined
				});

				console.log('✅  Connected to server');

				if (config.verbose) {
					client.trackProgress(info => {
						console.log(`  Uploaded: ${(info.bytes / 1024).toFixed(1)}KB`);
					});
				}

				const remote_file_path = path.posix.join(config.remotePath, 'deploy.zip');
				await this.uploadWithRetry(client, zip_path, remote_file_path, config);

			} finally {
				client.close();
				console.log('✅  FTP connection closed');
			}

			// Trigger remote deployment staging
			console.log('');
			await this.triggerDeploymentStaging(config.deployUrl, config);

			// Cleanup
			await this.cleanup(zip_path, config);

			const duration = ((Date.now() - start_time) / 1000).toFixed(2);
			console.log(`\n✅ Deployment staged successfully in ${duration}s\n`);

		} catch (error) {
			console.error(`\n❌ Deployment failed: ${error.message}\n`);

			const zip_path = path.join(this.ROOT, 'deploy.zip');
			await this.cleanup(zip_path, config);

			throw error;
		}
	}

	/**
	 * Obfuscation only pipeline (no deployment)
	 */
	async obfuscateOnly() {
		const start_time = Date.now();
		const config = await this.loadConfig();

		try {
			console.log('🔒 Starting obfuscation process...\n');

			// JavaScript obfuscation
			if (this.options.obfuscateJs || config.obfuscateJs) {
				const js_src = this.options.jsSrcPath || config.jsSrcPath || 'public/js';
				const js_dest = this.options.jsDestPath || config.jsDestPath || 'public/orig';

				if (!fs.existsSync(js_src)) {
					console.error(`❌ JavaScript source directory not found: ${js_src}`);
					throw new Error(`JavaScript source directory not found: ${js_src}`);
				}

				await this.obfuscateJavaScript(js_src, js_dest, config);

				// Swap directories for production use
				await this.rename_directories(js_src, js_dest);
			}

			// PHP obfuscation
			if (this.options.obfuscatePhp || config.obfuscatePhp) {
				await this.obfuscatePhp();
			}

			const duration = ((Date.now() - start_time) / 1000).toFixed(2);
			console.log(`\n✅ Obfuscation completed in ${duration}s\n`);

		} catch (error) {
			console.error(`\n❌ Obfuscation failed: ${error.message}\n`);
			throw error;
		}
	}
	
	/**
	* DATABASE MIGRATION & SEED METHODS
	*/

	/**
	 * Initialize database connection and migration system
	 */
	async initDatabase() {
		if (this.db) return this.db;
		
		const config = await this.loadConfig();
		
		// Load database config from environment or config file
		this.dbConfig = {
			host: config.databaseHost,
			user: config.databaseUser,
			password: config.databasePassword,
			database: config.databaseName,
			port: config.databasePort,
			waitForConnections: config.waitDatabaseForConnections,
			connectionLimit: config.databaseConnectionLimit,
			queueLimit: config.databaseQueueLimit
		};
		
		try {
			this.db = await mysql.createConnection(this.dbConfig);
			await this.createMigrationsTable();
			
			if (this.options.verbose) {
				console.log('✅ Database connected successfully');
			}
			
			return this.db;
		} catch (error) {
			throw new Error(`❌ Database connection failed: ${error.message}`);
		}
	}

	/**
	 * Create migrations tracking table
	 */
	async createMigrationsTable() {
		const sql = `
			CREATE TABLE IF NOT EXISTS migrations (
				id INT AUTO_INCREMENT PRIMARY KEY,
				migration VARCHAR(255) NOT NULL,
				batch INT NOT NULL,
				executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				UNIQUE KEY unique_migration (migration)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		`;
		
		await this.db.execute(sql);
	}

	/**
	 * Create a new migration file
	 */
	async createMigration(options) {
		const { name, table, template = 'create', lang = 'js', verbose } = options;
		
		// Generate timestamp for migration filename
		const now = new Date();
		const timestamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
		
		// Determine file extension based on language
		const extension = lang === 'php' ? '.php' : '.mjs';
		
		const filename = `${timestamp}_${name}${extension}`;
		const migrationsDir = path.join(this.ROOT, 'public/storage/database', 'migrations');
		
		// Ensure migrations directory exists
		await fs.ensureDir(migrationsDir);
		
		const filepath = path.join(migrationsDir, filename);
		
		// Generate migration template based on type and language
		let templateContent = await this.getMigrationTemplate(template, name, table, lang);
		
		// Remove backticks from template content (for PHP files)
		if (lang === 'php') {
			templateContent = templateContent.replace(/`/g, '');
		}
		
		// Write the migration file
		await fs.writeFile(filepath, templateContent);
		
		if (verbose) {
			console.log(`📝 Created ${lang.toUpperCase()} migration: ${filename}`);
		} else {
			console.log(`   ✅ Created: ${filename} (${lang.toUpperCase()})`);
		}
		
		// Auto-generate MigrationRunner for PHP projects
		if (lang === 'php') {
			await this.ensureMigrationRunnerExists();
		}
		
		return filepath;
	}

	/**
	 * Get migration template content from partials folder
	 */
	async getMigrationTemplate(type, name, table, lang = 'js') {
		const timestamp = new Date().toISOString();
		const tableName = table || name.replace(/_table$/, '');
		
		let templatePath;
		
		// Select template based on type and language
		// Template files should follow pattern: migrations/{type}.{lang}
		// e.g., migrations/create.js, migrations/create.php
		switch(type) {
			case 'create':
				templatePath = `migrations/create.${lang}`;
				break;
			
			case 'alter':
				templatePath = `migrations/alter.${lang}`;
				break;
			
			case 'drop':
				templatePath = `migrations/drop.${lang}`;
				break;
			
			default:
				templatePath = `migrations/default.${lang}`;
				break;
		}
		
		// Generate class name for PHP migrations
		const className = this.generateClassName(name);
		
		// Read and process the template
		const templateContent = await this.templatesReader(templatePath, {
			name: name,
			tableName: tableName,
			timestamp: timestamp,
			className: className
		});
		
		return templateContent;
	}

	/**
	 * Generate class name from migration name
	 * e.g., "create_users_table" → "CreateUsersTable"
	 */
	generateClassName(name) {
		// Remove timestamp prefix if present
		const nameWithoutTimestamp = name.replace(/^\d+_/, '');
		
		// Convert snake_case to PascalCase
		return nameWithoutTimestamp
			.split('_')
			.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
			.join('');
	}

	/**
	 * Template reader utility
	 * @param {string} templatePath - Path to template file relative to partials directory
	 * @param {Object} variables - Key-value pairs to replace in the template
	 * @returns {Promise<string>} - Processed template content
	 */
	async templatesReader(templatePath, variables = {}) { 
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = path.dirname(__filename);
		const partialsDir = path.join(__dirname, 'partials');
		const fullPath = path.join(partialsDir, templatePath);
		
		if (!await fs.pathExists(fullPath)) {
			throw new Error(`Template file not found: ${fullPath}`);
		}
		
		let templateContent = await fs.readFile(fullPath, 'utf-8');
		
		// Replace all variables in the template
		for (const [key, value] of Object.entries(variables)) {
			const placeholder = `{{${key}}}`; 
			templateContent = templateContent.split(placeholder).join(value);
		}
		
		// Remove backticks from template content
		templateContent = templateContent.replace(/`/g, ''); 

        // Remove semicolons after closing braces
        templateContent = templateContent.replace(/}(\s*);/g, '}$1');
        
        // Remove extra semicolons that became orphaned
        templateContent = templateContent.replace(/^\s*;\s*$/gm, '');

		return templateContent;
	}

	/**
	 * Run pending migrations
	 */
	async runMigrations(options = {}) {
		const { step, dryRun = false, verbose = false } = options;
		
		// Ensure database is initialized
		await this.initDatabase();
		
		try {
			const migrationsDir = path.join(this.ROOT, 'public/storage/database', 'migrations');
			
			if (!await fs.pathExists(migrationsDir)) {
				console.log('📁 No migrations directory found. Creating...');
				await fs.ensureDir(migrationsDir);
				return;
			}
			
			// Get all migration files
			let migrationFiles = await fs.readdir(migrationsDir);
			migrationFiles = migrationFiles.filter(file => file.endsWith('.mjs')).sort();
			
			if (migrationFiles.length === 0) {
				console.log('📁 No migration files found');
				return;
			}
			
			// Get already executed migrations
			const [executed] = await this.db.execute(
				'SELECT migration FROM migrations ORDER BY batch, id'
			);
			const executedMigrations = new Set(executed.map(row => row.migration));
			
			// Filter pending migrations
			let pending = migrationFiles.filter(file => !executedMigrations.has(file));
			
			if (step && step > 0) {
				pending = pending.slice(0, step);
			}
			
			if (pending.length === 0) {
				console.log('✅ No pending migrations');
				return;
			}
			
			if (dryRun) {
				console.log('\n📋 Pending migrations:');
				pending.forEach(file => console.log(`   • ${file}`));
				return;
			}
			
			// Get current batch number
			const [lastBatch] = await this.db.execute(
				'SELECT COALESCE(MAX(batch), 0) as max_batch FROM migrations'
			);
			const currentBatch = (lastBatch[0].max_batch || 0) + 1;
			
			console.log(`\n🔄 Running ${pending.length} migration(s) in batch ${currentBatch}...\n`);
			
			// Run migrations
			let successCount = 0;
			let errorCount = 0;
			
			for (const file of pending) {
				if (verbose) {
					console.log(`   📝 Running: ${file}`);
				}
				
				try {
					const migrationPath = path.join(migrationsDir, file);
					const migration = await import(`file://${migrationPath}`);
					
					if (typeof migration.up !== 'function') {
						throw new Error(`Migration ${file} does not export an 'up' function`);
					}
					
					await migration.up(this.db);
					
					// Record migration
					await this.db.execute(
						'INSERT INTO migrations (migration, batch) VALUES (?, ?)',
						[file, currentBatch]
					);
					
					successCount++;
					if (verbose) {
						console.log(`   ✅ Completed: ${file}`);
					} else {
						console.log(`   ✅ ${file}`);
					}
					
				} catch (err) {
					errorCount++;
					console.error(`   ❌ Failed: ${file}`);
					console.error(`      Error: ${err.message}`);
					
					if (verbose) {
						console.error(err.stack);
					}
					
					// Stop execution on error
					throw new Error(`Migration failed: ${file} - ${err.message}`);
				}
			}
			
			console.log(`\n✅ Migrations completed: ${successCount} succeeded, ${errorCount} failed`);
			
		} finally {
			// Always close the database connection
			await this.closeDatabase();
		}
	}

	/**
	 * Rollback migrations
	 */
	async rollbackMigrations(options = {}) {
		const { step = 1, target, dryRun = false, verbose = false } = options;
		
		await this.initDatabase();
		
		try {
			let migrationsToRollback;
			
			if (target) {
				// Rollback to specific migration (including that migration)
				const [rows] = await this.db.execute(
					'SELECT migration FROM migrations WHERE migration >= ? ORDER BY batch DESC, id DESC',
					[target]
				);
				migrationsToRollback = rows;
			} else {
				// Rollback last batch(es)
				let batches;
				
				if (step === 1) {
					const [rows] = await this.db.execute(
						'SELECT MAX(batch) as batch FROM migrations'
					);
					batches = rows[0].batch ? [{ batch: rows[0].batch }] : [];
				} else {
					const [rows] = await this.db.execute(
						'SELECT DISTINCT batch FROM migrations ORDER BY batch DESC LIMIT ?',
						[step]
					);
					batches = rows;
				}
				
				if (batches.length === 0 || !batches[0].batch) {
					console.log('✅ No migrations to rollback');
					return;
				}
				
				const batchNumbers = batches.map(b => b.batch);
				const placeholders = batchNumbers.map(() => '?').join(',');
				
				const [rows] = await this.db.execute(
					`SELECT migration FROM migrations WHERE batch IN (${placeholders}) ORDER BY batch DESC, id DESC`,
					batchNumbers
				);
				migrationsToRollback = rows;
			}
			
			if (migrationsToRollback.length === 0) {
				console.log('✅ No migrations to rollback');
				return;
			}
			
			if (dryRun) {
				console.log('\n📋 Migrations to rollback:');
				migrationsToRollback.forEach(m => console.log(`   • ${m.migration}`));
				return;
			}
			
			console.log(`\n⏪ Rolling back ${migrationsToRollback.length} migration(s)...\n`);
			
			const migrationsDir = path.join(this.ROOT, 'public/storage/database', 'migrations');
			let successCount = 0;
			let errorCount = 0;
			
			for (const migration of migrationsToRollback) {
				const file = migration.migration;
				
				if (verbose) {
					console.log(`   📝 Rolling back: ${file}`);
				} else {
					console.log(`   ⏪ ${file}`);
				}
				
				try {
					const migrationPath = path.join(migrationsDir, file);
					if (!await fs.pathExists(migrationPath)) {
						console.warn(`   ⚠️  Migration file not found: ${file}`);
						// Remove from migrations table
						await this.db.execute(
							'DELETE FROM migrations WHERE migration = ?',
							[file]
						);
						successCount++;
						continue;
					}
					
					const migrationModule = await import(`file://${migrationPath}`);
					
					if (typeof migrationModule.down !== 'function') {
						throw new Error(`Migration ${file} does not export a 'down' function`);
					}
					
					await migrationModule.down(this.db);
					
					// Remove from migrations table
					await this.db.execute(
						'DELETE FROM migrations WHERE migration = ?',
						[file]
					);
					
					successCount++;
					if (verbose) {
						console.log(`   ✅ Rolled back: ${file}`);
					}
					
				} catch (err) {
					errorCount++;
					console.error(`   ❌ Failed to rollback: ${file}`);
					console.error(`      Error: ${err.message}`);
					throw new Error(`Rollback failed: ${file} - ${err.message}`);
				}
			}
			
			console.log(`\n✅ Rollback completed: ${successCount} succeeded, ${errorCount} failed`);
			
		} finally {
			// Always close the database connection
			await this.closeDatabase();
		}
	}
	
	/**
	 * Show migration status
	 */
	async showMigrationStatus(verbose = false) {
		await this.initDatabase();
		
		try {
			const migrationsDir = path.join(this.ROOT, 'public/storage/database', 'migrations');
			
			if (!await fs.pathExists(migrationsDir)) {
				console.log('📁 No migrations directory found');
				return;
			}
			
			// Get all migration files
			let migrationFiles = await fs.readdir(migrationsDir);
			migrationFiles = migrationFiles.filter(file => file.endsWith('.mjs')).sort();
			
			if (migrationFiles.length === 0) {
				console.log('📁 No migration files found');
				return;
			}
			
			// Get executed migrations
			const [executed] = await this.db.execute(
				'SELECT migration, batch, executed_at FROM migrations ORDER BY batch, id'
			);
			
			const executedMap = new Map();
			executed.forEach(row => {
				executedMap.set(row.migration, {
					batch: row.batch,
					executed_at: row.executed_at
				});
			});
			
			// Display table
			console.log('\n┌' + '─'.repeat(50) + '┬' + '─'.repeat(10) + '┬' + '─'.repeat(25) + '┐');
			console.log('│ ' + 'Migration'.padEnd(48) + ' │ ' + 'Status'.padEnd(8) + ' │ ' + 'Batch/Date'.padEnd(23) + ' │');
			console.log('├' + '─'.repeat(50) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(25) + '┤');
			
			for (const file of migrationFiles) {
				const status = executedMap.get(file);
				const statusText = status ? '✓ APPLIED' : '○ PENDING';
				const info = status 
					? `Batch ${status.batch}`
					: 'Not executed';
				
				const fileName = file.length > 46 ? file.substring(0, 43) + '...' : file;
				console.log(`│ ${fileName.padEnd(48)} │ ${statusText.padEnd(8)} │ ${info.padEnd(23)} │`);
			}
			
			console.log('└' + '─'.repeat(50) + '┴' + '─'.repeat(10) + '┴' + '─'.repeat(25) + '┘');
			
			if (verbose && executed.length > 0) {
				console.log('\n📋 Execution Details:');
				for (const row of executed) {
					const date = new Date(row.executed_at).toLocaleString();
					console.log(`   • ${row.migration} - Batch ${row.batch} (${date})`);
				}
			}
			
			console.log(`\n📊 Summary: ${executed.length} executed, ${migrationFiles.length - executed.length} pending`);
			
		} finally {
			// Always close the database connection
			await this.closeDatabase();
		}
	}

	/**
	 * Reset all migrations (rollback all and run fresh)
	 */
	async resetMigrations(options = {}) {
		const { seed = false, verbose = false } = options;
		
		console.log('\n🔄 Resetting database migrations...\n');
		
		await this.initDatabase();
		
		// Get all executed migrations
		const [migrations] = await this.db.execute(
			'SELECT migration FROM migrations ORDER BY batch DESC, id DESC'
		);
		
		if (migrations.length > 0) {
			console.log(`📋 Found ${migrations.length} migrations to rollback...\n`);
			
			// Rollback all migrations
			const migrationsDir = path.join(this.ROOT, 'public/storage/database', 'migrations');
			
			for (const migration of migrations) {
				const file = migration.migration;
				
				if (verbose) {
					console.log(`   📝 Rolling back: ${file}`);
				}
				
				try {
					const migrationPath = path.join(migrationsDir, file);
					if (await fs.pathExists(migrationPath)) { 
						const migrationModule = await import(`file://${migrationPath}`);
							
						if (typeof migrationModule.down === 'function') {
							await migrationModule.down(this.db);
						}
					}
					
					await this.db.execute(
						'DELETE FROM migrations WHERE migration = ?',
						[file]
					);
					
					if (!verbose) {
						console.log(`   ✅ ${file}`);
					} else {
						console.log(`   ✅ Rolled back: ${file}`);
					}
					
				} catch (err) {
					console.error(`   ❌ Failed to rollback: ${file}`);
					console.error(`      Error: ${err.message}`);
					throw err;
				}
			}
			
			console.log(`\n✅ Rolled back ${migrations.length} migration(s)\n`);
		} else {
			console.log('No migrations to rollback\n');
		}
		
		// Run migrations fresh
		console.log('🔄 Running fresh migrations...\n');
		await this.runMigrations({ verbose });
		
		// Run seeders if requested
		if (seed) {
			console.log('\n🌱 Running seeders...');
			await this.runSeeders({ force: true, verbose });
		}
		
		console.log('\n✅ Database reset completed successfully');
	}

	/**
	 * Create a new seeder file
	 */
	async createSeeder(options) {
		const { name, verbose } = options;
		
		const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
		const filename = `${timestamp}_${name}.mjs`;
		const seedersDir = path.join(this.ROOT, 'public/storage/database', 'seeders');
		
		// Ensure seeders directory exists
		await fs.ensureDir(seedersDir);
		
		const filepath = path.join(seedersDir, filename);
		
		// Get seeder template
		let templateContent = await this.getSeederTemplate(name, timestamp);
		
		// Write the seeder file
		await fs.writeFile(filepath, templateContent);
		
		if (verbose) {
			console.log(`📝 Created seeder: ${filename}`);
		} else {
			console.log(`   ✅ Created: ${filename}`);
		}
		
		return filepath;
	}

	/**
	 * Get seeder template content from partials folder
	 */
	async getSeederTemplate(name, timestamp) {
		const templateContent = await this.templatesReader('seeders/default.js', {
			name: name,
			timestamp: timestamp
		});

		return templateContent;
	}

	/**
	 * Run database seeders
	 */
	async runSeeders(options = {}) {
		const { seederClass, force = false, verbose = false } = options;
		
		// Ensure database is initialized
		await this.initDatabase();
		
		try {
			const seedersDir = path.join(this.ROOT, 'public/storage/database', 'seeders');
			
			if (!await fs.pathExists(seedersDir)) {
				console.log('📁 No seeders directory found. Creating...');
				await fs.ensureDir(seedersDir);
				
				// Create example seeder
				const timestamp = new Date().toISOString();
				const exampleSeeder = await this.templatesReader('seeders/example.js', {
					timestamp: timestamp
				});
				
				await fs.writeFile(path.join(seedersDir, 'ExampleSeeder.mjs'), exampleSeeder);
				console.log('   📝 Created example seeder: ExampleSeeder.mjs');
				return;
			}
			
			let seederFiles = await fs.readdir(seedersDir);
			seederFiles = seederFiles.filter(file => file.endsWith('.js') || file.endsWith('.mjs'));
			
			if (seederClass) {
				seederFiles = seederFiles.filter(file => file.includes(seederClass));
			}
			
			if (seederFiles.length === 0) {
				console.log('No seeders found');
				return;
			}
			
			console.log(`\n🌱 Running ${seederFiles.length} seeder(s)...\n`);
			
			let successCount = 0;
			
			for (const file of seederFiles) {
				if (verbose) {
					console.log(`   📝 Running: ${file}`);
				} else {
					console.log(`   🌱 ${file}`);
				}
				
				try {
					const seederPath = path.join(seedersDir, file); 
					const seeder = await import(`file://${seederPath}`);

					if (typeof seeder.run !== 'function') {
						throw new Error(`Seeder ${file} does not export a 'run' function`);
					}
					
					await seeder.run(this.db);
					successCount++;
					
					if (verbose) {
						console.log(`   ✅ Completed: ${file}`);
					}
					
				} catch (err) {
					console.error(`   ❌ Failed: ${file}`);
					console.error(`      Error: ${err.message}`);
					
					if (verbose && err.stack) {
						console.error(err.stack);
					}
					
					if (!force) {
						throw err;
					}
				}
			}
			
			console.log(`\n✅ Seeders completed: ${successCount}/${seederFiles.length} succeeded`);
			
		} finally {
			// Close database connection
			await this.closeDatabase();
		}
	}

	/**
	 * Generate multiple services at once
	 */
	async generateServices(serviceNames, type = 'general') {
		console.log('\n📝 Generating service classes...\n');

		let created = 0;
		let skipped = 0;
		const results = [];

		for (const name of serviceNames) {
			try {
				const result = await this.createService({
					name: name,
					type: type,
					verbose: this.options.verbose || false
				});
				
				if (result.created) {
					created++;
				} else if (result.skipped) {
					skipped++;
				}
				
				results.push(result);
			} catch (error) {
				console.error(`   ❌ Failed to create service '${name}': ${error.message}`);
				if (this.options.verbose) {
					console.error(error.stack);
				}
			}
		}

		console.log(`\n   Summary: ${created} created, ${skipped} already existed`);
		
		return {
			created,
			skipped,
			results
		};
	}

	/**
	 * Create a single service class
	 */
	async createService(options) {
		const { name, type = 'general', verbose } = options;

		// Ensure name is in PascalCase
		const className = name.charAt(0).toUpperCase() + name.slice(1);
		const filename = `${className}.php`;
		const servicesDir = path.join(this.ROOT, 'app', 'Services');

		// Ensure services directory exists
		await fs.ensureDir(servicesDir);

		const filepath = path.join(servicesDir, filename);

		// Check if service already exists
		if (await fs.pathExists(filepath)) {
			if (verbose) {
				console.log(`   ⏭️  Service '${className}' already exists`);
			} else {
				console.log(`   ⏭️  ${className} already exists`);
			}
			return { name: className, path: filepath, created: false, skipped: true };
		}

		// Select template based on type
		let templatePath;
		const templateVariables = {
			className: className,
			timestamp: new Date().toISOString()
		};

		switch (type) {
			case 'migration':
				templatePath = 'services/migration_runner.php';
				break;
			case 'general':
			default:
				templatePath = 'services/service.php';
				break;
		}

		// Read the service template
		let templateContent = await this.templatesReader(templatePath, templateVariables);
		
		await fs.writeFile(filepath, templateContent);

		if (verbose) {
			console.log(`   ✅ Created ${type} service: ${filename}`);
		} else {
			console.log(`   ✅ ${className}`);
		}

		return { name: className, path: filepath, created: true, skipped: false };
	}

	async ensureMigrationRunnerExists() {
		const runnerPath = path.join(this.ROOT, 'app/Services/MigrationRunner.php');
		
		if (!await fs.pathExists(runnerPath)) {
			if (this.options.verbose) {
				console.log('\n⚙️  MigrationRunner service not found. Creating...');
			}
			
			// Use createService with the migration type
			await this.createService({
				name: 'MigrationRunner',
				type: 'migration',
				verbose: false
			});
			
			console.log('   ✅ MigrationRunner service auto-generated');
		} else if (this.options.verbose) {
			console.log('   ℹ️  MigrationRunner already exists');
		}
	}

	/**
	 * Close database connection
	 */
	async closeDatabase() {
		if (this.db) {
			await this.db.end();
			if (this.options.verbose) {
				console.log('✅ Database connection closed');
			}
		}
	}
}

export default App;