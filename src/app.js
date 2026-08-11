import 'dotenv/config';
import fs from 'fs-extra';
import path from 'path';
import ignore from 'ignore';
import archiver from 'archiver';
import ftp from 'basic-ftp';
import fetch from 'node-fetch';
import { execa } from 'execa'; 
import { fileURLToPath } from 'url';
import { execSync } from 'child_process'; 
import JavaScriptObfuscator from 'javascript-obfuscator';
import { promisify } from 'util';
import { glob } from 'glob';
import { simpleGit } from 'simple-git';
import dns from "node:dns/promises";
import https from 'https';
import fg from 'fast-glob';
import mysql from 'mysql2/promise';
import pg from 'pg'; 
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

class App {
    constructor(options = {}) {
        // Path helpers as instance properties
        this.ROOT = process.cwd();

        // Promisify glob as instance method
        this.globPromise = promisify(glob);

        this.git = simpleGit(this.ROOT);
        
        // Support per-distribution last deploy files
        this.distributionName = options.distributionName || 'default';
        this.LAST_DEPLOY_FILE = path.join(
            this.ROOT, 
            `.last-deploy-${this.distributionName}`
        );

        this.config = {};

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

            // Deploy options
            includeDependencies: false,
            includeUnstaged: false,
            includeUntracked: false,
            fullDeployment: false,
            stagedOnly: false,

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

            // Distribution metadata
            distributionName: 'default',
            distributionIndex: 0,

            ...options
        };
    }

	/**
	 * Logging helper for consistent verbose output
	 * 
	 * @param {string} message - The message to log
	 * @param {boolean} isVerbose - Whether this is a verbose-only message
	 * @param {string} type - Message type for icon prefix (info, success, error, warn, skip, progress, deploy, lock, archive, upload, db, git, clean, revert, template, controller, service)
	 */
	log(message, isVerbose = false, type = 'info') {
		if (!isVerbose || (isVerbose && this.config?.verbose)) {
			const icons = {
				space: '',
				info: 'ℹ️',
				success: '✅',
				error: '❌',
				warn: '⚠️',
				skip: '⏭️',
				progress: '⏳',
				deploy: '🚀',
				lock: '🔒',
				archive: '📦',
				upload: '📤',
				db: '🗄️',
				git: '📊',
				clean: '🧹',
				revert: '🔄',
				template: '📝',
				controller: '🎮',
				service: '⚙️',
				migration: '🔄',
				seeder: '🌱',
				scan: '🔍',
				connect: '🔗',
				trigger: '🛠️',
				backup: '💾',
				file: '📄',
				folder: '📁',
				js: '📜',
				php: '🐘'
			};
			
			        
			const icon = icons[type] || '';
			const trimmedMessage = message.trim();
			
			if (icon) {
				console.log(` ${icon} ${trimmedMessage}`);
			} else {
				console.log(`   ${trimmedMessage}`);
			}
		}
	}

	/** 
	 * CONFIGURATION METHODS
	*/
	async loadConfig() { 
		const config = this.options;

		this.config = {
			host: config.host,
			username: config.username,
			password: process.env.DEPLOY_PASSWORD || config.password,
			remotePath: config.remotePath,
			deployPath: config.deployPath,
			branch: config.branch || 'develop',
			version: config.version || process.env.APP_VERSION || '',
			deployUrl: config.deployUrl ? config.deployUrl : null,
			secure: this.options.secure || config.secure || false,
			rejectUnauthorized: config.rejectUnauthorized || false,
			maxRetries: config.maxRetries || 3,
			retryDelay: config.retryDelay || 2000,
			ftpTimeout: config.ftpTimeout || 0, // 120 s
			allowBackup: config.allowBackup || false,
			cleanupLocal: config.cleanupLocal || false,
			runMigrations: config.runMigrations || false,
			clearCache: config.clearCache || false,
			runComposer: config.runComposer || false,
			verbose: this.options.verbose || config.verbose || false,
			framework: config.framework || '',
			exclusiveFiles: config.exclude || [],
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

		const { address } = await dns.lookup(
			this.config.host,
			{ family: 4 }
		);

		this.config.host = address;

		return this.config;
	}

	validateConfig(config) { 
		const required = ['host', 'username', 'password', 'remotePath', 'deployPath'];
		const missing = required.filter(key => !config[key]);

		if (missing.length) {
			throw new Error(
				`Missing required configuration fields: ${missing.join(', ')}`
			);
		}

		if (config.password === 'your-password-here') {
			throw new Error(
				'Please update the default password in .xfixrc.json or set DEPLOY_PASSWORD environment variable'
			);
		}
	}

	/** 
	 * FILE & IGNORE METHODS
	*/
	loadIgnore(includeDependencies = false) { 
		const ig = ignore();
		const ignoreFile = path.join(this.ROOT, '.updateignore');

		if (fs.existsSync(ignoreFile)) {
			const content = fs.readFileSync(ignoreFile, 'utf-8');
			ig.add(content.split('\n').filter(line => line.trim() && !line.startsWith('#')));
		}

		// Always ignore these files
		let exclusives = [
			'.git',
			'.last-deploy',
			'.gitattributes',
			'.updateignore',
			'.xfixrc.json', 
			'deploy.zip',
			'.DS_Store',
			'Thumbs.db',
			'obfuscated',
			'public/orig',
			'public/original_js_asset_folder',
			'.env',
			'.env.local',
			'.env.production',
			'.htaccess',
			'.htpasswd',
			'.git/',
			'.svn/',
			'.env.example',

			// harmful/unneccessary files
			'vendor/**/[..*',
			'vendor/**/[..*.*',
			'vendor/**/[...*',
			'vendor/**/[...*.*',
			'node_modules/**/[..*',
			'node_modules/**/[..*.*',
			'node_modules/**/[...*',
			'node_modules/**/[...*.*',
			'node_modules/**/.gitattributes',
			'node_modules/**/.gitignore',
			'node_modules/**/.npmignore',
			'node_modules/**/.eslintrc*',
			'node_modules/**/test/**',
			'node_modules/**/docs/**',
			'node_modules/**/process.env.js'
		];

		// Conditionally ignore vendor and node_modules
		if (!includeDependencies) {
			exclusives.push(
				'vendor',
				'node_modules'
			);
		}

		ig.add(exclusives);
		
		return ig;
	}

	filterFiles(files, ig) {
		const filtered = [];
		const excluded = [];
	
		files.forEach((changedFile) => {
			let rel;
			
			// Handle both string paths and change objects
			if (typeof changedFile === 'string') {
				rel = path.relative(this.ROOT, changedFile);
			} else {
				// Extract relative path from change object
				rel = changedFile.file || path.relative(this.ROOT, changedFile.fullPath);
			}
	
			const isIgnored = ig.ignores(rel);

			if (isIgnored) {
				excluded.push(rel);
				this.log(`  Skipped (filtered & ignored): ${rel}`, true);
			} else {
				filtered.push(changedFile);
			}
		});
	
		return {
			filtered,
			excluded
		};
	}
	
    /**
     * Get the last deploy hash for the current distribution
     */
    async getLastDeployHash() {
        try {
            if (await fs.pathExists(this.LAST_DEPLOY_FILE)) {
                return (await fs.readFile(this.LAST_DEPLOY_FILE, 'utf-8')).trim();
            }
            return null;
        } catch (error) {
            this.log(`Could not read last deploy file: ${error.message}`, true, 'warn');
            return null;
        }
    }

    /**
     * Update deploy marker for the current distribution
     */
    async updateDeployMarker() {
        try {
            const hash = (await this.git.revparse(['HEAD'])).trim();
            await fs.writeFile(this.LAST_DEPLOY_FILE, hash);
            this.log(`Updated deploy marker for ${this.distributionName}: ${hash.substring(0, 8)}`, true);
        } catch (error) {
            this.log(`Failed to update deploy marker: ${error.message}`, true, 'error');
            throw error;
        }
    }

    /**
     * Get deployment marker status
     */
    async getDeployStatus() {
        const lastHash = await this.getLastDeployHash();
        const currentHash = (await this.git.revparse(['HEAD'])).trim();
        
        return {
            lastHash,
            currentHash,
            isUpToDate: lastHash === currentHash,
            hasDeployed: lastHash !== null
        };
    }

    /**
     * List all distribution deploy markers
     */
    async listDeployMarkers() {
        const files = await fs.readdir(this.ROOT);
        const markers = files
            .filter(f => f.startsWith('.last-deploy-'))
            .map(f => {
                const distName = f.replace('.last-deploy-', '');
                return {
                    file: f,
                    distribution: distName
                };
            });
        
        return markers;
    }

    /**
     * Reset deploy marker for current distribution
     */
    async resetDeployMarker() {
        try {
            if (await fs.pathExists(this.LAST_DEPLOY_FILE)) {
                await fs.remove(this.LAST_DEPLOY_FILE);
                this.log(`Removed deploy marker for ${this.distributionName}`, true);
                return true;
            }
            return false;
        } catch (error) {
            this.log(`Failed to reset deploy marker: ${error.message}`, true, 'error');
            throw error;
        }
    }

    /**
     * Get updated files with per-distribution tracking
     */
    async getUpdatedFiles(config, options = {}) {
        const {
            includeUnstaged = false,
            includeUntracked = false,
            stagedOnly = false,
            includeCommitted = true
        } = options;

        // Get last deploy hash for this distribution
        let lastDeploy = await this.getLastDeployHash();

        // First deploy - all tracked files (only for non-secure mode)
        if (!lastDeploy && includeCommitted) {
            try {
                const files = await this.git.raw(['ls-files']);
                const changes = files
                    .trim()
                    .split('\n')
                    .filter(Boolean)
                    .map(f => ({
                        status: 'A',
                        file: f,
                        fullPath: path.join(this.ROOT, f),
                        committed: true,
                        staged: true
                    }));

                this.options.total = changes.length;
                this.options.included = changes.length;
                this.options.excluded = 0;

                // Create initial deploy marker after first deployment
                if (this.options.deploy) {
                    await this.updateDeployMarker();
                }

                return changes;
            } catch (error) {
                throw new Error(`Failed to get initial file list: ${error.message}`);
            }
        }

        try {
            let allChanges = [];

            // Get committed changes if requested
            if (includeCommitted && lastDeploy) {
                const diffArgs = stagedOnly ? ['--cached'] : [];
                const diff = await this.git.diff([
                    '--name-status',
                    '--diff-filter=ACMRT',
                    ...diffArgs,
                    `${lastDeploy}..HEAD`
                ]);
                
                const committedChanges = this.parseDiffOutput(diff, { 
                    committed: true,
                    staged: true 
                });
                
                allChanges.push(...committedChanges);
            }

            // Get unstaged changes if requested
            if (includeUnstaged) {
                const unstagedChanges = await this.getUnstagedChanges();
                allChanges.push(...unstagedChanges);
            }

            // Get untracked files if requested
            if (includeUntracked) {
                const untrackedFiles = await this.getUntrackedFiles();
                allChanges.push(...untrackedFiles);
            }

            // Remove duplicates
            allChanges = this.deduplicateChanges(allChanges);

            // Warn if no changes detected
            if (allChanges.length === 0 && config.verbose) {
                this.log(`No changes detected for ${this.distributionName}`, true, 'info');
            }

            // Update stats and display
            this.updateChangeStats(allChanges, config);
            
            return allChanges;

        } catch (error) {
            if (error.message.includes('unknown revision')) {
                throw new Error(
                    `Deploy marker for ${this.distributionName} references invalid commit: ${lastDeploy}\n` +
                    'Try deleting .last-deploy file for full deployment'
                );
            }
            throw error;
        }
    }

	/**
	 * Remove duplicate file entries, preferring unstaged versions
	 */
	deduplicateChanges(changes) {
		const fileMap = new Map();
		
		changes.forEach(change => {
			const key = change.file;
			
			if (!fileMap.has(key)) {
				fileMap.set(key, change);
			} else {
				// Prefer unstaged/untracked versions over committed
				const existing = fileMap.get(key);
				if (change.staged === false || change.untracked) {
					fileMap.set(key, change);
				}
			}
		});
		
		return Array.from(fileMap.values());
	}
	
	/**
	 * Get unstaged changes in working directory
	 */
	async getUnstagedChanges() {
		const status = await this.git.status();
		const changes = [];
	
		// Modified but not staged
		status.modified.forEach(file => {
			changes.push({
				status: 'M',
				file,
				fullPath: path.join(this.ROOT, file),
				staged: false,
				committed: false
			});
		});
	
		// Deleted but not staged
		status.deleted.forEach(file => {
			changes.push({
				status: 'D',
				file,
				fullPath: path.join(this.ROOT, file),
				staged: false,
				committed: false
			});
		});
	
		// Renamed in working directory
		if (status.renamed) {
			status.renamed.forEach(rename => {
				changes.push({
					status: 'R',
					oldFile: rename.from,
					file: rename.to,
					fullPath: path.join(this.ROOT, rename.to),
					staged: false,
					committed: false
				});
			});
		}
	
		return changes;
	}
	
	/**
	 * Get untracked files
	 */
	async getUntrackedFiles() {
		const untracked = await this.git.raw([
			'ls-files',
			'--others',
			'--exclude-standard'
		]);
	
		return untracked
			.trim()
			.split('\n')
			.filter(Boolean)
			.map(file => ({
				status: 'A',
				file,
				fullPath: path.join(this.ROOT, file),
				untracked: true,
				committed: false,
				staged: false
			}));
	}
	
	/**
	 * Parse git diff output
	 */
	parseDiffOutput(diff, metadata = {}) {
		return diff
			.trim()
			.split('\n')
			.filter(Boolean)
			.map(line => {
				const parts = line.split('\t');
				const status = parts[0];
	
				// Handle renames (R100, R050, etc.)
				if (status?.startsWith('R')) {
					const similarity = status.substring(1);
					const newFile = parts[2];
	
					if (!newFile) return null;
	
					return {
						status: 'R',
						similarity,
						oldFile: parts[1],
						file: newFile,
						fullPath: path.join(this.ROOT, newFile),
						...metadata
					};
				}
	
				// Handle copies
				if (status?.startsWith('C')) {
					const similarity = status.substring(1);
					const newFile = parts[2];
	
					if (!newFile) return null;
	
					return {
						status: 'C',
						similarity,
						oldFile: parts[1],
						file: newFile,
						fullPath: path.join(this.ROOT, newFile),
						...metadata
					};
				}
	
				// Handle type changes
				if (status?.startsWith('T')) {
					const file = parts[1];
					if (!file || typeof file !== 'string') return null;
					
					return {
						status: 'T',
						file,
						fullPath: path.join(this.ROOT, file),
						...metadata
					};
				}
	
				const file = parts[1];
	
				if (!file || typeof file !== 'string') return null;
	
				return {
					status,
					file,
					fullPath: path.join(this.ROOT, file),
					...metadata
				};
			})
			.filter(Boolean);
	}
	
	/**
	 * Update change statistics and display
	 */
	updateChangeStats(changes, config) {
		if (config.verbose) {
			const statusCounts = {};
			
			changes.forEach(change => {
				let key = change.status;
				
				if (change.untracked) {
					key = 'Untracked';
				} else if (change.staged === false) {
					key = `${change.status} (unstaged)`;
				} else if (change.committed) {
					key = `${change.status} (committed)`;
				}
				
				statusCounts[key] = (statusCounts[key] || 0) + 1;
			});
	
			this.log('Git detected changes:', false, 'git');
			Object.entries(statusCounts).forEach(([status, count]) => {
				const statusLabel = {
					'A (committed)': 'Added (committed)',
					'M (committed)': 'Modified (committed)',
					'D (committed)': 'Deleted (committed)',
					'R (committed)': 'Renamed (committed)',
					'C (committed)': 'Copied (committed)',
					'T (committed)': 'Type Changed (committed)',
					'A (unstaged)': 'Added (unstaged)',
					'M (unstaged)': 'Modified (unstaged)',
					'D (unstaged)': 'Deleted (unstaged)',
					'R (unstaged)': 'Renamed (unstaged)',
					'Untracked': 'New/Untracked'
				}[status] || status;
				this.log(`${statusLabel}: ${count} files`);
			});
		}
	
		// Update stats
		this.options.total = changes.length;
		this.options.included = changes.filter(c => c.status !== 'D').length;
		this.options.excluded = changes.filter(c => c.status === 'D').length;
	}

	async getAllFiles(dir = this.ROOT, depth = 0, maxDepth = 50) {
		if (depth > maxDepth) {
			throw new Error(`Maximum directory depth (${maxDepth}) exceeded at: ${dir}`);
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

	/**
	 * Get files for deployment based on mode and options
	 */
	async getDeploymentFiles(config, ig) {
		let files;
		
		const isSecure = this.options.obfuscateJs || 
						config.obfuscateJs || 
						this.options.obfuscatePhp || 
						config.obfuscatePhp;

		// Force full deployment if requested
		if (this.options.fullDeployment) {
			this.log('  Force full deployment requested...', true);
			files = await this.getAllFiles();
		} else if (isSecure) {
			// deploy unstaged/working directory changes
			this.log('  Since you are using secure mode, deploying unstaged changes only...', true);
			
			const options = {
				includeUnstaged: true,
				includeUntracked: this.options.includeUntracked !== false,
				stagedOnly: false,
				includeCommitted: false
			};
			
			files = await this.getUpdatedFiles(config, options);
			
			// If includeDependencies is set, add vendor and node_modules
			if (this.options.includeDependencies) {
				this.log('  Including vendor/ and node_modules/ in secure deployment...', true);
				
				const dependencyFiles = await this.getDependencyFiles();
				
				if (dependencyFiles.length > 0) {
					files = [...files, ...dependencyFiles];
					this.log(`  Added ${dependencyFiles.length} dependency files`, true);
				} else {
					this.log('  No dependency files found to include', true);
				}
			}
		} else {
			// Non-secure mode: deploy based on options
			const options = {
				includeUnstaged: this.options.includeUnstaged || false,
				includeUntracked: this.options.includeUntracked || false,
				stagedOnly: this.options.stagedOnly || false,
				includeCommitted: !this.options.includeUnstaged || this.options.stagedOnly
			};
			
			if (config.verbose) {
				const mode = [];
				if (options.stagedOnly) mode.push('staged only');
				if (options.includeUnstaged) mode.push('including unstaged');
				if (options.includeUntracked) mode.push('including untracked');
				if (!options.includeCommitted) mode.push('excluding committed');
				
				this.log(`  Deploying changes: ${mode.length > 0 ? mode.join(', ') : 'committed only'}...`);
			}
			
			files = await this.getUpdatedFiles(config, options);
			
			// If includeDependencies is set, add vendor and node_modules
			if (this.options.includeDependencies) {
				this.log('  Including vendor/ and node_modules/ in deployment...', true);
				
				const dependencyFiles = await this.getDependencyFiles();
				
				if (dependencyFiles.length > 0) {
					files = [...files, ...dependencyFiles];
					this.log(`  Added ${dependencyFiles.length} dependency files`, true);
				} else {
					this.log('  No dependency files found to include', true);
				}
			}
		}

		// Filter through ignore patterns
		const { filtered, excluded } = this.filterFiles(files, ig, config);

		let filePaths;
		if (this.options.fullDeployment) {
			// getAllFiles returns plain strings, use as-is
			filePaths = filtered;
		} else {
			// getUpdatedFiles returns objects with fullPath
			filePaths = filtered.map(change => { 
				if (typeof change === 'string') {
					return change;
				}
				return change.fullPath;
			});
		}

		// Calculate and update stats
		const stats = {
			total: files.length,
			included: filtered.length,
			excluded: excluded.length || (files.length - filtered.length)
		};

		this.options.total = stats['total'];
		this.options.included = stats['included'];
		this.options.excluded = stats['excluded'];

		// Display summary
		this.displayDeploymentSummary(filtered, stats, isSecure);

		// Validate files exist
		if (!stats.included) {
			this.throwNoFilesError(isSecure);
		}

		return {
			filePaths,
			stats,
			isSecure,
			filtered
		};
	}

	/**
	 * Get dependency files from vendor and node_modules
	 * In secure mode, scans filesystem for all dependency files
	 * In non-secure mode, tries git first, falls back to filesystem
	 */
	async getDependencyFiles() {
		const dependencyPaths = [];
		const vendorPath = path.join(this.ROOT, 'vendor');
		const nodeModulesPath = path.join(this.ROOT, 'node_modules');
		
		const isSecure = this.options.obfuscateJs || 
						this.config?.obfuscateJs || 
						this.options.obfuscatePhp || 
						this.config?.obfuscatePhp;
		
		try { 
			if (await fs.pathExists(vendorPath)) {
				if (!isSecure) {
					// Non-secure: Try git first
					try {
						const trackedVendorFiles = await this.git.raw([
							'ls-files',
							'--cached',
							'--others',
							'--exclude-standard',
							'vendor/'
						]);
						
						if (trackedVendorFiles.trim()) {
							const vendorFiles = trackedVendorFiles
								.trim()
								.split('\n')
								.filter(Boolean)
								.map(file => ({
									status: 'A',
									file: file,
									fullPath: path.join(this.ROOT, file),
									dependency: true,
									committed: true,
									staged: true
								}));
							
							dependencyPaths.push(...vendorFiles);
							this.log(`  Found ${vendorFiles.length} vendor files (git)`, true);
						} else {
							// Fall back to filesystem
							const vendorFiles = await this.getFilesFromDirectory(vendorPath);
							dependencyPaths.push(...vendorFiles);
							this.log(`  Found ${vendorFiles.length} vendor files (filesystem)`, true);
						}
					} catch (error) {
						// fall back to filesystem
						const vendorFiles = await this.getFilesFromDirectory(vendorPath);
						dependencyPaths.push(...vendorFiles);
						this.log(`  Found ${vendorFiles.length} vendor files (filesystem)`, true);
					}
				} else {
					// Always scan filesystem for all dependency files
					const vendorFiles = await this.getFilesFromDirectory(vendorPath);
					dependencyPaths.push(...vendorFiles);
					this.log(`  Found ${vendorFiles.length} vendor files (filesystem)`, true);
				}
			} else {
				this.log('  vendor/ directory not found', true);
			}
			
			if (await fs.pathExists(nodeModulesPath)) {
				if (!isSecure) {
					// Non-secure: Try git first
					try {
						const trackedNodeFiles = await this.git.raw([
							'ls-files',
							'--cached',
							'--others',
							'--exclude-standard',
							'node_modules/'
						]);
						
						if (trackedNodeFiles.trim()) {
							const nodeFiles = trackedNodeFiles
								.trim()
								.split('\n')
								.filter(Boolean)
								.map(file => ({
									status: 'A',
									file: file,
									fullPath: path.join(this.ROOT, file),
									dependency: true,
									committed: true,
									staged: true
								}));
							
							dependencyPaths.push(...nodeFiles);
							this.log(`  Found ${nodeFiles.length} node_modules files (git)`, true);
						} else {
							// Fall back to filesystem
							const nodeFiles = await this.getFilesFromDirectory(nodeModulesPath);
							dependencyPaths.push(...nodeFiles);
							this.log(`  Found ${nodeFiles.length} node_modules files (filesystem)`, true);
						}
					} catch (error) {
						// Git failed, fall back to filesystem
						const nodeFiles = await this.getFilesFromDirectory(nodeModulesPath);
						dependencyPaths.push(...nodeFiles);
						this.log(`  Found ${nodeFiles.length} node_modules files (filesystem)`, true);
					}
				} else {
					// Always scan filesystem for all dependency files
					const nodeFiles = await this.getFilesFromDirectory(nodeModulesPath);
					dependencyPaths.push(...nodeFiles);
					this.log(`  Found ${nodeFiles.length} node_modules files (filesystem)`, true);
				}
			} else {
				this.log('  node_modules/ directory not found', true);
			}
			
		} catch (error) {
			this.log(`  Warning: Could not get dependency files: ${error.message}`, true, 'warning');
		}
		
		return dependencyPaths;
	}

	/**
	 * Get all files from a directory recursively (filesystem scan)
	 * Used primarily in secure mode to include all dependency files
	 */
	async getFilesFromDirectory(dirPath) {
		const files = [];
		
		try {
			const entries = await fs.readdir(dirPath, { withFileTypes: true });
			
			for (const entry of entries) {
				const fullPath = path.join(dirPath, entry.name);
				const relativePath = path.relative(this.ROOT, fullPath).replace(/\\/g, '/');
				
				// Skip common unnecessary files in dependencies - ensure safety & security is not compromised
				const skipDirs = ['.git', '.svn', 'test', 'tests', 'docs', 'examples', 'node_modules'];
				const skipFiles = ['.gitattributes', '.gitignore', '.npmignore', '.eslintrc', 'process.env.js'];
				const skipExtensions = ['.md', '.markdown', '.txt', '.log'];
				
				if (entry.isDirectory()) {
					// Skip unnecessary directories
					if (skipDirs.includes(entry.name)) {
						continue;
					}
					
					const subFiles = await this.getFilesFromDirectory(fullPath);
					files.push(...subFiles);
				} else if (entry.isFile()) {
					// Skip unnecessary files
					if (skipFiles.some(f => entry.name.startsWith(f))) {
						continue;
					}
					
					const ext = path.extname(entry.name).toLowerCase();
					if (skipExtensions.includes(ext) && 
						entry.name !== 'composer.lock' && 
						entry.name !== 'package-lock.json') {
						continue;
					}
					
					files.push({
						status: 'A',
						file: relativePath,
						fullPath: fullPath,
						dependency: true,
						committed: false,
						staged: false
					});
				}
			}
		} catch (error) {
			this.log(`  Cannot read directory ${dirPath}: ${error.message}`, true);
		}
		
		return files;
	}

	/**
	 * Display deployment summary
	 */
	displayDeploymentSummary(filtered, stats, isSecure) {
		if (this.options.fullDeployment) {
			this.log(
				` Full deployment: ${stats.total} total files, ${stats.included} included, ${stats.excluded} excluded`, true, 'info'
			);
		} else if (isSecure) {
			const unstagedCount = filtered.filter(f => f.staged === false && !f.untracked).length;
			const untrackedCount = filtered.filter(f => f.untracked === true).length;
			
			let message = `Secure deployment: ${stats.included} unstaged files`;
			
			const details = [];
			if (unstagedCount > 0) details.push(`${unstagedCount} modified`);
			if (untrackedCount > 0) details.push(`${untrackedCount} new/untracked`);
			
			if (details.length > 0) {
				message += ` (${details.join(', ')})`;
			}
			
			message += `, ${stats.excluded} excluded`;
			this.log(message, true, 'info');
		} else {
			const mode = this.options.stagedOnly ? 'staged' : 
						this.options.includeUnstaged ? 'committed + unstaged' : 'committed';
			
			let message = `Incremental deployment (${mode}): ${stats.included} files`;
			
			const details = [];
			const committedCount = filtered.filter(f => f.committed).length;
			const unstagedCount = filtered.filter(f => f.staged === false && !f.untracked).length;
			const untrackedCount = filtered.filter(f => f.untracked).length;
			
			if (committedCount > 0) details.push(`${committedCount} committed`);
			if (unstagedCount > 0) details.push(`${unstagedCount} unstaged`);
			if (untrackedCount > 0) details.push(`${untrackedCount} untracked`);
			
			if (details.length > 0) {
				message += ` (${details.join(', ')})`;
			}
			
			message += `, ${stats.excluded} excluded`;
			this.log(message, true, 'info');
		}
	}

	/**
	 * Throw descriptive error when no files to deploy
	 */
	throwNoFilesError(isSecure) {
		if (this.options.fullDeployment) {
			throw new Error(
				'No files to deploy.\n' +
				'  - Check your .updateignore configuration\n' +
				'  - Verify project structure has files'
			);
		} else if (isSecure) {
			throw new Error(
				'No unstaged changes to deploy.\n' +
				'  Options:\n' +
				'  - Make changes to your files first, then run deploy\n' +
				'  - Use --full for a complete deployment\n' +
				'  - Check your .updateignore configuration'
			);
		} else if (this.options.stagedOnly) {
			throw new Error(
				'No staged changes to deploy.\n' +
				'  Options:\n' +
				'  - Stage your changes first (git add)\n' +
				'  - Use --include-unstaged to include working directory changes\n' +
				'  - Use --full for a complete deployment\n' +
				'  - Delete .last-deploy file for a full deployment'
			);
		} else {
			throw new Error(
				'No committed changes to deploy.\n' +
				'  Options:\n' +
				'  - Commit your changes first (git commit)\n' +
				'  - Use --include-unstaged to include working directory changes\n' +
				'  - Use --full for a complete deployment\n' +
				'  - Delete .last-deploy file for a full deployment'
			);
		}
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
				this.log(`Archive created (${sizeInMB} MB, ${processedFiles} files)`, false, 'archive');
				resolve();
			});

			archive.on('error', reject);
			output.on('error', reject);

			archive.on('progress', (progress) => {
				if (progress.entries && progress.entries.processed > processedFiles) {
					processedFiles = progress.entries.processed;
					if (config.verbose) {
						this.log(`  Adding: ${processedFiles}/${totalFiles} files`);
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
			const { stdout: branch } = await execa('git', [
				'rev-parse',
				'--abbrev-ref',
				'HEAD'
			]);

			const currentBranch = branch.trim();

			if (currentBranch !== expectedBranch) {
				throw new Error(
					`Branch mismatch. Expected "${expectedBranch}", but currently on "${currentBranch}"`
				);
			}

			this.log(`Branch verified: ${currentBranch}`, true, 'info');
			return currentBranch;
		} catch (error) {
			if (error.message.includes('Branch mismatch')) {
				throw error;
			}
			throw new Error('Failed to validate git branch. Are you in a git repository?');
		}
	}

	async uploadWithRetry(client, localPath, remotePath, config) {
		let lastError;

		for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
			try {
				this.log(`Upload attempt ${attempt}/${config.maxRetries}...`, false, 'upload');

				await client.uploadFrom(localPath, remotePath);

				this.log('Upload complete', false, 'success');
				return;
			} catch (error) {
				lastError = error;

				if (attempt < config.maxRetries) {
					this.log(`  Upload attempt ${attempt} failed, retrying in ${config.retryDelay/1000}s...`);
					await new Promise(resolve => setTimeout(resolve, config.retryDelay));
				}
			}
		}

		throw new Error(`Upload failed after ${config.maxRetries} attempts: ${lastError.message}`);
	}

	async triggerDeploymentStaging(deployUrl, config) {
		if (!deployUrl) {
			this.log('No deployUrl configured, skipping remote deployment staging', false, 'info');
			return;
		}

		this.log('Triggering remote deployment staging...', false, 'info');

		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 300000);
			const payload = {};

			Object.entries(config).forEach(([key, value]) => {
				if (value !== undefined && value !== null) {
					payload[key] = value;
				}
			});

			const agent = new https.Agent({
				family: 4,
				keepAlive: true
			});

			const res = await fetch(deployUrl, {
				method: 'POST',
				agent,
				signal: controller.signal,
				body: JSON.stringify(payload),
				headers: {
					'Content-Type': 'application/json',
					'User-Agent': 'XFIX-Deploy/1.0',
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
				this.log('Remote deployment staging triggered successfully', false, 'info');
				this.log(`Files deployed: ${this.options.included || 'N/A'}`, false, 'info');
				this.log(`Version: ${config?.version || 'N/A'}`, false, 'info');
			} else {
				throw new Error(responseData.message || 'Unknown deployment error');
			}

		} catch (error) { 
			console.error('FETCH ERROR:', error);
			console.error('NAME:', error.name);
			console.error('MESSAGE:', error.message);
			console.error('CODE:', error.code);
			console.error('CAUSE:', error.cause);

			if (error.name === 'AbortError') {
				console.log('STAGING ABORTION EXCEPTION: ', 'Remote deployment staging request timed out after 5 minutes');
				return;
			}

			console.log('STAGING ERROR EXCEPTION: ', error?.message || 'Remote deployment staging request timed out after 5 minutes')
		}
	}

	async cleanup(zipPath, config) {
		if (config.cleanupLocal && await fs.pathExists(zipPath)) {
			await fs.remove(zipPath);
			this.log('Cleanup complete', false, 'info');
		}
	}

	/**
	 * Cleanup after deployment (revert obfuscation and clean files)
	 */
	async cleanupAfterDeployment(success = true) {
		try {
			// Revert JavaScript obfuscation
			if (this.options.obfuscateJs || this.config?.obfuscateJs) {
				await this.revert_js_obfuscation();
			}

			// Revert PHP obfuscation
			if (this.options.obfuscatePhp || this.config?.obfuscatePhp) {
				await this.revert_php_obfuscation();
			}
			
			// Clean up deployment zip
			if (success) {
				const zip_path = path.join(this.ROOT, 'deploy.zip');
				await this.cleanup(zip_path, this.config);
			}
		} catch (cleanupError) {
			this.log(`Cleanup error: ${cleanupError.message}`, true, 'error');
		}
	}

	/** 
	 * OBFUSCATION METHODS
	*/
	get_excluded_js_files() {
		let excluded = [

			// Exact core libs
			'vendor.js',
			'init.js',
		
			// jQuery
			'jquery.js',
			'jquery.min.js',
			'jquery-ui.js',
			'jquery-ui.min.js',
		
			// Icons
			'icons.min.js',
		
			// General minified files
			'**/*.min.js',
		
			// Vendor directories
			'**/vendor/**',
			'**/node_modules/**',
		
			// Large libraries
			'**/ckeditor*/**',
			'**/tinymce*/**',
			'**/datatables*/**',
			'**/chart*/**',
		
			// Build outputs
			'**/dist/**',
			'**/build/**',
		
			// Optional modern frameworks
			'**/bootstrap*/**',
			'**/select2*/**',
			'**/moment*/**',
			'**/fullcalendar*/**'
		];

		if (this.config?.exclusiveFiles?.length) {
			this.config.exclusiveFiles.forEach(file => {
				// Only exclude JavaScript files for obfuscation
				if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) {
					if (!excluded.includes(file)) {
						excluded.push(file);
						this.log(`Excluding JS from obfuscation: ${file}`, true);
					}
				} else {
					// For non-JS files, they'll be handled by the PHP obfuscation's ignore list
					this.log(`Non-JS file in exclusiveFiles: ${file} (handled elsewhere)`, true);
				}
			});
		}
	
		return excluded;
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
		this.log('\nStarting JavaScript obfuscation...', false, 'info');
		this.log(`Source: ${srcPath}`);
		this.log(`Destination: ${destPath}`);
	
		if (config.domainLock && config.domainLock.length > 0) {
			this.log(`Domain Lock: ${config.domainLock.join(', ')}`, false, 'lock');
			this.log(`Redirect URL: ${config.domainLockRedirectUrl}`, false, 'info');
		}
	
		// Create destination directory
		await fs.ensureDir(destPath);
	
		// Preserve originals
		if (config.preserveOriginal) {
			const preserveDir = config.preserveOriginal;
	
			if (fs.existsSync(srcPath)) {
				await this.copy_folder_recursive(srcPath, preserveDir);
	
				this.log(
					`Original files preserved in: ${preserveDir}`,
					false,
					'backup'
				);
			}
		}
	
		const exclude_files = this.get_excluded_js_files();
		const obfuscator_config = this.get_obfuscator_config(config);
	
		// Get all JS files
		const files = glob.sync(`${srcPath}/**/*.js`, {
			nodir: true
		});
	
		for (const file of files) {
			try {
	
				const relativePath = path.relative(srcPath, file);
	
				// Skip excluded files
				const isExcluded = exclude_files.some(excluded =>
					relativePath.includes(excluded)
				);
	
				if (isExcluded) {
					const destFile = path.join(destPath, relativePath);
	
					await fs.ensureDir(path.dirname(destFile));
					await fs.copy(file, destFile);
					if (config.verbose) {
						this.log(`Skipped: ${relativePath}`, false, 'warning');
					}

					continue;
				}
	
				// Skip large/minified/vendor files
				const stat = await fs.stat(file);
	
				if (
					stat.size > 1024 * 1024 || // 1MB+
					file.includes('.min.js') ||
					file.includes('/vendor/') ||
					file.includes('/node_modules/')
				) {
					const destFile = path.join(destPath, relativePath);
	
					await fs.ensureDir(path.dirname(destFile));
					await fs.copy(file, destFile);
	
					if (config.verbose) {
						this.log(`Copied without obfuscation: ${relativePath}`, false, 'warning');
					}

					continue;
				}
	

				if (config.verbose) {
					this.log(`Obfuscating: ${relativePath}`);
				}

				// Read source
				const code = await fs.readFile(file, 'utf8');
	
				// Obfuscate
				const obfuscated = JavaScriptObfuscator
						.obfuscate(code, obfuscator_config)
						.getObfuscatedCode();
	
				// Write output
				const destFile = path.join(destPath, relativePath);
	
				await fs.ensureDir(path.dirname(destFile));
	
				await fs.writeFile(destFile, obfuscated);
	
				// Release references
				global.gc?.();
	
			} catch (error) {
				this.log(`Failed: ${file}`, false, 'error');
				console.error(error);
			}
		}
	
		this.log('JavaScript obfuscation completed', false, 'success');
	}

	async copy_excluded_js_files(srcPath, destPath, exclude_files) {
		for (const fileName of exclude_files) {
			const srcFile = path.join(srcPath, fileName);
			const destFile = path.join(destPath, fileName);

			if (fs.existsSync(srcFile)) {
				await fs.copyFile(srcFile, destFile);
				this.log(`Copied (excluded): ${fileName}`, true);
			}
		}
	}

	async obfuscatePhp() {
		this.log('\nStarting PHP obfuscation...', false, 'info'); 

		// Check yakpro-po
		let yakproPath;

		try {
			const command = process.platform === 'win32'
				? 'where.exe yakpro-po'
				: 'which yakpro-po';

			yakproPath = execSync(command, { encoding: 'utf-8' })
				.split(/\r?\n/)[0]
				.trim();

			this.log(`Using: ${yakproPath}`);
		} catch (error) {
			throw new Error('yakpro-po is not installed.');
		}
		
		// Get ignore filter
		const includeDeps = this.options.includeDependencies || false;
		const ig = this.loadIgnore(includeDeps);

		if (this.config?.exclusiveFiles?.length) {
			this.config.exclusiveFiles.forEach(file => {
				ig.add(file);
				this.log(`Excluding from obfuscation: ${file}`, true);
			});
		}

		// Scan for PHP files
		let phpFiles = [];

		try {
			phpFiles = await this.scan_php_files_with_ignore(ig);
			this.log(`Found ${phpFiles.length} PHP files to obfuscate`, true, 'info');
		} catch (error) {
			this.log(`File scan failed: ${error.message}`, true, 'error');
			return;
		}

		if (phpFiles.length === 0) {
			this.log('No PHP files found to obfuscate', false, 'info');
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
				const cnfFile = 'yakpro-po.cnf'
				const cnf = path.join(this.ROOT, cnfFile);
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
						`\r   [${processed + 1}/${total}] ${percent}% - ${displayFile.padEnd(40)}`
					);

					const cnfOption = await fs.pathExists(cnf)
						? ` -c "${cnf}"`
						: '';

					execSync(
						`"${yakproPath}" "${sourcePath}" -o "${outputFile}"${cnfOption}`,
						{
							stdio: 'pipe',
							timeout: 60000
						}
					);
					
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
		this.log(' ', false, 'space');
		this.log(`PHP obfuscation completed in ${duration}s`, true, 'info');
		this.log(`Successfully processed: ${processed}/${total} files`, true, 'success');

		if (failed > 0) {
			this.log(`Failed: ${failed} files`, true, 'error');
		}

		// REPLACE ORIGINAL FILES WITH OBFUSCATED ONES
		if (processed > 0) {
			this.log('\nReplacing original PHP files with obfuscated versions...', false, 'info');

			try {
				await this.replace_php_files(phpFiles, failedFiles);
				this.log('PHP files replaced successfully', false, 'info');
			} catch (error) {
				this.log(`Failed to replace files: ${error.message}`, true, 'error');
				this.log('   Obfuscated files are available in the "obfuscated/" directory', true, 'info');
			}
		}

		this.log(' ', false, 'space');
	}

	/**
	 * Replace original PHP files with obfuscated versions
	 * Creates a backup of originals first
	 */
	async replace_php_files(phpFiles, failedFiles) {
		const failedFileNames = new Set(failedFiles.map(f => f.file));
		const backupDir = path.join(this.ROOT, 'original_php_backup');

		this.log(`Creating backup in: ${path.relative(this.ROOT, backupDir)}`, false, 'backup');

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
					this.log(`Obfuscated file not found: ${file}`, true);
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
					this.log(`Replaced: ${replaced} files`, true, 'progress');
				}

			} catch (error) {
				this.log(`Failed to replace ${file}: ${error.message}`, true);
			}
		}

		this.log(`Backed up: ${backedUp} original files`);
		this.log(`Replaced: ${replaced} files with obfuscated versions`);

		// Clean up obfuscated directory after successful replacement
		if (replaced > 0) {
			try {
				await fs.remove(path.join(this.ROOT, 'obfuscated'));
				this.log('   Cleaned up obfuscated/ directory', false, 'info');
			} catch (error) {
				this.log('   Could not clean up obfuscated/ directory', true);
			}
		}
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
						this.log(`Ignored: ${normalizedPath}`, true);
						continue;
					}

					if (entry.isDirectory()) {
						await scan(fullPath, normalizedPath);
					} else if (entry.isFile() && entry.name.endsWith('.php')) {
						phpFiles.push(normalizedPath);
					}
				}
			} catch (error) {
				this.log(`Cannot access directory: ${dir} (${error.message})`, true);
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
			this.log('No PHP backup found. Nothing to revert.', true);
			return;
		}

		this.log('\nReverting PHP files to original versions...', false, 'info');

		// Count backup files
		const backupFiles = await this.count_files_recursive(backupDir);
		this.log(`Found ${backupFiles} backed up PHP files`);

		// Copy backup files back to original locations
		await this.copy_folder_recursive(backupDir, this.ROOT);

		this.log(`Reverted ${backupFiles} PHP files`);

		// Clean up backup
		try {
			await fs.remove(backupDir);
			this.log('Cleaned up backup directory', false, 'info');
		} catch (error) {
			this.log(`Could not clean up backup directory: ${error.message}`, true);
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
			this.log('No obfuscated JavaScript found. Nothing to revert.', true);
			return;
		}

		this.log('\nReverting JavaScript files to original versions...', false, 'info');

		// If we have a backup, restore from it
		if (fs.existsSync(preserveDir)) {
			this.log(`Restoring from backup: ${preserveDir}`);

			// Remove current obfuscated files
			if (fs.existsSync(jsSrc)) {
				await fs.remove(jsSrc);
			}

			// Restore original files
			await fs.ensureDir(jsSrc);
			await this.copy_folder_recursive(preserveDir, jsSrc);

			// Clean up backup
			await fs.remove(preserveDir);
			this.log('   Cleaned up backup directory', false, 'info');
		} else {
			// No backup, try swapping directories back
			if (fs.existsSync(jsDest)) {
				this.log('   Swapping directories back...', false, 'info');
				await this.rename_directories(jsDest, jsSrc);
			}
		}

		this.log('JavaScript files reverted successfully', false, 'info');
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
			this.log('Cannot swap directories: one or both paths do not exist', 'true', 'warn');
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

			this.log('Directories swapped successfully', false, 'info');
		} catch (error) {
			this.log(`Directory swap failed: ${error.message}`, true, 'error');

			// Attempt recovery
			try {
				if (fs.existsSync(tempPath)) {
					await fs.move(tempPath, srcPath, {
						overwrite: true
					});
				}
			} catch (recoveryError) {
				this.log(`Recovery failed: ${recoveryError.message}`, true, 'error');
			}

			throw error;
		}
	}
	
	async generateControllers(controllers = []) {
		this.log('\nGenerating controllers...', false, 'info');

		const controllers_dir = path.join(this.ROOT, 'app', 'http', 'controllers');
		await fs.ensureDir(controllers_dir);

		let generated = 0;
		let existing = 0;

		for (const controller of controllers) {
			const controller_name = controller.charAt(0).toUpperCase() + controller.slice(1);
			const controller_file_name = controller_name + '.php';
			const controller_file_path = path.join(controllers_dir, controller_file_name);

			if (await fs.pathExists(controller_file_path)) {
				this.log(`Controller '${controller_name}' already exists`, true);
				existing++;
				continue;
			}
			
			// Read the controller template 
			let templateContent = await this.templatesReader('controllers/template.php', {
				controller_name: controller_name
			});
			
			await fs.writeFile(controller_file_path, templateContent);
			this.log(`Controller '${controller_name}' generated`);
			generated++;
		}

		this.log(`\n   Summary: ${generated} created, ${existing} already existed`);
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
			this.log('Starting XFIX deployment...', false, 'deploy');

			// Validate configuration
			this.validateConfig(config);

			// Create Services - Make services ready available in production
			const framework = config?.framework || 'selfphp';
			if (framework === 'selfphp') {
				this.createService({
					name: 'MigrationRunner',
					type: 'migration',
					verbose: this.options.verbose || false, 
				});
			}

			// ============================================
			// PRE-DEPLOYMENT: Obfuscation
			// ============================================

			if (this.options.obfuscateJs || config.obfuscateJs) {
				const js_src = this.options.jsSrcPath || config.jsSrcPath || 'public/js';
				const js_dest = this.options.jsDestPath || config.jsDestPath || 'public/orig';

				if (!fs.existsSync(js_src)) {
					this.log(`JavaScript source directory not found: ${js_src}`, true, 'warn');
					this.log('   Skipping JS obfuscation', true, 'warn');
				} else {
					await this.obfuscateJavaScript(js_src, js_dest, config);
					await this.rename_directories(js_src, js_dest);
				}
			}

			if (this.options.obfuscatePhp || config.obfuscatePhp) {
				await this.obfuscatePhp();
			}

			let secure = false;
			if (this.options.obfuscateJs || 
				config.obfuscateJs || 
				this.options.obfuscatePhp || 
				config.obfuscatePhp) {
				secure = true;
			}

			// ============================================
			// DEPLOYMENT PIPELINE
			// ============================================

			// Validate branch
			await this.validateBranch(config?.branch || 'main');

			// Scan and filter files
			this.log('Scanning project files...', false, 'scan');
			const includeDeps = this.options.includeDependencies || false;
			const ig = this.loadIgnore(includeDeps); 
			
			const { filePaths, stats, isSecure } = await this.getDeploymentFiles(config, ig);

			if (!stats.included) return;

			// Create archive
			const zip_path = path.join(this.ROOT, 'deploy.zip');
			this.log('Creating archive...', false, 'archive');
			await this.createArchive(zip_path, filePaths, config);

			// Upload to server
			this.log('Connecting to server...', false, 'connect');
			const client = new ftp.Client(config.ftpTimeout);
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

				this.log('Connected to server', false, 'success');

				if (config.verbose) {
					client.trackProgress(info => {
						this.log(`  Uploaded: ${(info.bytes / 1024).toFixed(1)}KB`, true, 'upload');
					});
				}

				const remote_file_path = path.posix.join(config.remotePath, 'deploy.zip');
				await this.uploadWithRetry(client, zip_path, remote_file_path, config);

			} finally {
				client.close();
				this.log('	FTP connection closed', false, 'info');
			}

			// Trigger remote deployment staging
			this.log(' ', false, 'space');
			await this.triggerDeploymentStaging(config.deployUrl, config);

			// Update deploy marker only for non-secure incremental deployments
			if (!isSecure) {
				await this.updateDeployMarker();
			}

			const duration = ((Date.now() - start_time) / 1000).toFixed(2);
			this.log(`\nDeployment staged successfully in ${duration}s\n`, true, 'success');

			// Cleanup after successful deployment
			await this.cleanupAfterDeployment(true);

		} catch (error) {
			const zip_path = path.join(this.ROOT, 'deploy.zip');
			await this.cleanup(zip_path, config);

			// Revert obfuscation on error
			await this.cleanupAfterDeployment(false);

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
			this.log('Starting obfuscation process...\n', false, 'info');

			// JavaScript obfuscation
			if (this.options.obfuscateJs || config.obfuscateJs) {
				const js_src = this.options.jsSrcPath || config.jsSrcPath || 'public/js';
				const js_dest = this.options.jsDestPath || config.jsDestPath || 'public/orig';

				if (!fs.existsSync(js_src)) {
					this.log(`JavaScript source directory not found: ${js_src}`, true, 'error');
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
			this.log(`\nObfuscation completed in ${duration}s\n`, true, 'success');

		} catch (error) {
			this.log(`\nObfuscation failed: ${error.message}\n`, true, 'error');
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
			
			this.log('Database connected successfully', true);
			
			return this.db;
		} catch (error) {
			throw new Error(`Database connection failed: ${error.message}`);
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
			this.log(`Created ${lang.toUpperCase()} migration: ${filename}`);
		} else {
			this.log(`Created: ${filename} (${lang.toUpperCase()})`);
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
		
		const templatePathExt = templatePath.split('.').pop();
		
		if (templatePathExt.trim() == 'php') {
			// Remove backticks from template content
			templateContent = templateContent.replace(/`/g, ''); 

			// Remove semicolons after closing braces
			templateContent = templateContent.replace(/}(\s*);/g, '}$1');
			
			// Remove extra semicolons that became orphaned
			templateContent = templateContent.replace(/^\s*;\s*$/gm, '');
		}

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
				this.log('No migrations directory found. Creating...', false, 'info');
				await fs.ensureDir(migrationsDir);
				return;
			}
			
			// Get all migration files
			let migrationFiles = await fs.readdir(migrationsDir);
			migrationFiles = migrationFiles.filter(file => file.endsWith('.mjs')).sort();
			
			if (migrationFiles.length === 0) {
				this.log('No migration files found', false, 'info');
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
				this.log('No pending migrations', false, 'info');
				return;
			}
			
			if (dryRun) {
				this.log('\nPending migrations:', false, 'info');
				pending.forEach(file => this.log(`- ${file}`));
				return;
			}
			
			// Get current batch number
			const [lastBatch] = await this.db.execute(
				'SELECT COALESCE(MAX(batch), 0) as max_batch FROM migrations'
			);
			const currentBatch = (lastBatch[0].max_batch || 0) + 1;
			
			this.log(`\nRunning ${pending.length} migration(s) in batch ${currentBatch}...\n`, true, 'infor');
			
			// Run migrations
			let successCount = 0;
			let errorCount = 0;
			
			for (const file of pending) {
				if (verbose) {
					this.log(`Running: ${file}`, true, 'info');
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
						this.log(`Completed: ${file}`);
					} else {
						this.log(`${file}`);
					}
					
				} catch (err) {
					errorCount++;
					this.log(`Failed: ${file}`, true, 'error');
					this.log(`Error: ${err.message}`, false, 'error');
					
					if (verbose) {
						this.log(err.stack, true, 'error');
					}
					
					// Stop execution on error
					throw new Error(`Migration failed: ${file} - ${err.message}`);
				}
			}
			
			this.log(`\nMigrations completed: ${successCount} succeeded, ${errorCount} failed`, true, 'info');
			
		} finally {
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
				const [rows] = await this.db.execute(
					'SELECT migration FROM migrations WHERE migration >= ? ORDER BY batch DESC, id DESC',
					[target]
				);
				migrationsToRollback = rows;
			} else {
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
					this.log('No migrations to rollback', false, 'info');
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
				this.log('No migrations to rollback', false, 'info');
				return;
			}
			
			if (dryRun) {
				this.log('\nMigrations to rollback:', false, 'info');
				migrationsToRollback.forEach(m => this.log(`- ${m.migration}`));
				return;
			}
			
			this.log(`\nRolling back ${migrationsToRollback.length} migration(s)...\n`);
			
			const migrationsDir = path.join(this.ROOT, 'public/storage/database', 'migrations');
			let successCount = 0;
			let errorCount = 0;
			
			for (const migration of migrationsToRollback) {
				const file = migration.migration;
				
				if (verbose) {
					this.log(`Rolling back: ${file}`);
				} else {
					this.log(`${file}`);
				}
				
				try {
					const migrationPath = path.join(migrationsDir, file);
					if (!await fs.pathExists(migrationPath)) {
						this.log(`Migration file not found: ${file}`, true, 'warn');
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
					
					await this.db.execute(
						'DELETE FROM migrations WHERE migration = ?',
						[file]
					);
					
					successCount++;
					if (verbose) {
						this.log(`Rolled back: ${file}`);
					}
					
				} catch (err) {
					errorCount++;
					this.log(`Failed to rollback: ${file}`, true, 'error');
					this.log(`Error: ${err.message}`, false, 'error');
					throw new Error(`Rollback failed: ${file} - ${err.message}`);
				}
			}
			
			this.log(`\nRollback completed: ${successCount} succeeded, ${errorCount} failed`);
			
		} finally {
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
				this.log('No migrations directory found', false, 'info');
				return;
			}
			
			let migrationFiles = await fs.readdir(migrationsDir);
			migrationFiles = migrationFiles.filter(file => file.endsWith('.mjs')).sort();
			
			if (migrationFiles.length === 0) {
				this.log('No migration files found', false, 'info');
				return;
			}
			
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
			
			this.log('\n' + '-'.repeat(50) + '-' + '-'.repeat(10) + '-' + '-'.repeat(25));
			this.log(' ' + 'Migration'.padEnd(48) + '  ' + 'Status'.padEnd(8) + '  ' + 'Batch/Date'.padEnd(23));
			this.log('-'.repeat(50) + '-' + '-'.repeat(10) + '-' + '-'.repeat(25));
			
			for (const file of migrationFiles) {
				const status = executedMap.get(file);
				const statusText = status ? 'APPLIED' : 'PENDING';
				const info = status 
					? `Batch ${status.batch}`
					: 'Not executed';
				
				const fileName = file.length > 46 ? file.substring(0, 43) + '...' : file;
				this.log(` ${fileName.padEnd(48)}  ${statusText.padEnd(8)}  ${info.padEnd(23)}`);
			}
			
			this.log('-'.repeat(50) + '-' + '-'.repeat(10) + '-' + '-'.repeat(25));
			
			if (verbose && executed.length > 0) {
				this.log('\nExecution Details:', false, 'info');
				for (const row of executed) {
					const date = new Date(row.executed_at).toLocaleString();
					this.log(`- ${row.migration} - Batch ${row.batch} (${date})`);
				}
			}
			
			this.log(`\nSummary: ${executed.length} executed, ${migrationFiles.length - executed.length} pending`);
			
		} finally {
			await this.closeDatabase();
		}
	}

	/**
	 * Reset all migrations
	 */
	async resetMigrations(options = {}) {
		const { seed = false, verbose = false } = options;
		
		this.log('\nResetting database migrations...\n', false, 'info');
		
		await this.initDatabase();
		
		const [migrations] = await this.db.execute(
			'SELECT migration FROM migrations ORDER BY batch DESC, id DESC'
		);
		
		if (migrations.length > 0) {
			this.log(`Found ${migrations.length} migrations to rollback...\n`);
			
			const migrationsDir = path.join(this.ROOT, 'public/storage/database', 'migrations');
			
			for (const migration of migrations) {
				const file = migration.migration;
				
				if (verbose) {
					this.log(`Rolling back: ${file}`);
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
						this.log(`${file}`);
					} else {
						this.log(`Rolled back: ${file}`);
					}
					
				} catch (err) {
					this.log(`Failed to rollback: ${file}`, true, 'error');
					this.log(`Error: ${err.message}`, false, 'error');
					throw err;
				}
			}
			
			this.log(`\nRolled back ${migrations.length} migration(s)\n`);
		} else {
			this.log('No migrations to rollback\n', false, 'info');
		}
		
		this.log('Running fresh migrations...\n', false, 'info');
		await this.runMigrations({ verbose });
		
		if (seed) {
			this.log('\nRunning seeders...', false, 'info');
			await this.runSeeders({ force: true, verbose });
		}
		
		this.log('\nDatabase reset completed successfully', false, 'info');
	}

	/**
	 * Create a new seeder file
	 */
	async createSeeder(options) {
		const { name, verbose } = options;
		
		const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
		const filename = `${timestamp}_${name}.mjs`;
		const seedersDir = path.join(this.ROOT, 'public/storage/database', 'seeders');
		
		await fs.ensureDir(seedersDir);
		
		const filepath = path.join(seedersDir, filename);
		
		let templateContent = await this.getSeederTemplate(name, timestamp);
		
		await fs.writeFile(filepath, templateContent);
		
		if (verbose) {
			this.log(`Created seeder: ${filename}`);
		} else {
			this.log(`Created: ${filename}`);
		}
		
		return filepath;
	}

	/**
	 * Get seeder template content
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
		
		await this.initDatabase();
		
		try {
			const seedersDir = path.join(this.ROOT, 'public/storage/database', 'seeders');
			
			if (!await fs.pathExists(seedersDir)) {
				this.log('No seeders directory found. Creating...', false, 'info');
				await fs.ensureDir(seedersDir);
				
				const timestamp = new Date().toISOString();
				const exampleSeeder = await this.templatesReader('seeders/example.js', {
					timestamp: timestamp
				});
				
				await fs.writeFile(path.join(seedersDir, 'ExampleSeeder.mjs'), exampleSeeder);
				this.log('   Created example seeder: ExampleSeeder.mjs', false, 'info');
				return;
			}
			
			let seederFiles = await fs.readdir(seedersDir);
			seederFiles = seederFiles.filter(file => file.endsWith('.js') || file.endsWith('.mjs'));
			
			if (seederClass) {
				seederFiles = seederFiles.filter(file => file.includes(seederClass));
			}
			
			if (seederFiles.length === 0) {
				this.log('No seeders found', false, 'info');
				return;
			}
			
			this.log(`\nRunning ${seederFiles.length} seeder(s)...\n`);
			
			let successCount = 0;
			
			for (const file of seederFiles) {
				if (verbose) {
					this.log(`Running: ${file}`);
				} else {
					this.log(`${file}`);
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
						this.log(`Completed: ${file}`);
					}
					
				} catch (err) {
					this.log(`Failed: ${file}`, true, 'error');
					this.log(`Error: ${err.message}`, false, 'error');
					
					if (verbose && err.stack) {
						this.log(err.stack, true, 'error');
					}
					
					if (!force) {
						throw err;
					}
				}
			}
			
			this.log(`\nSeeders completed: ${successCount}/${seederFiles.length} succeeded`);
			
		} finally {
			await this.closeDatabase();
		}
	}

	/**
	 * Generate multiple services at once
	 */
	async generateServices(serviceNames, type = 'general') {
		this.log('\nGenerating service classes...\n', false, 'info');

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
				this.log(`Failed to create service '${name}': ${error.message}`, true, 'error');
				if (this.options.verbose) {
					this.log(error.stack, true, 'error');
				}
			}
		}

		this.log(`\n   Summary: ${created} created, ${skipped} already existed`, true, 'info');
		
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

		const className = name.charAt(0).toUpperCase() + name.slice(1);
		const filename = `${className}.php`;
		const servicesDir = path.join(this.ROOT, 'app', 'Services');

		await fs.ensureDir(servicesDir);

		const filepath = path.join(servicesDir, filename);

		if (await fs.pathExists(filepath)) {
			if (verbose) {
				this.log(`Service '${className}' already exists`);
			} else {
				this.log(`${className} already exists`);
			}
			return { name: className, path: filepath, created: false, skipped: true };
		}

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

		let templateContent = await this.templatesReader(templatePath, templateVariables);
		
		await fs.writeFile(filepath, templateContent);

		if (verbose) {
			this.log(`Created ${type} service: ${filename}`);
		} else {
			this.log(`${className}`);
		}

		return { name: className, path: filepath, created: true, skipped: false };
	}

	async ensureMigrationRunnerExists() {
		const runnerPath = path.join(this.ROOT, 'app/Services/MigrationRunner.php');
		
		if (!await fs.pathExists(runnerPath)) {
			this.log('\nMigrationRunner service not found. Creating...', true);
			
			await this.createService({
				name: 'MigrationRunner',
				type: 'migration',
				verbose: false
			});
			
			this.log('   MigrationRunner service auto-generated', false, 'info');
		} else {
			this.log('   MigrationRunner already exists', true);
		}
	}

	/**
	 * Close database connection
	 */
	async closeDatabase() {
		if (this.db) {
			await this.db.end();
			this.log('Database connection closed', true);
		}
	}
}

export default App;