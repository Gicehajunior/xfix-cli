import { Command } from 'commander';
import App from './app.js';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import path from 'path';

import {
    ANDROID_ENV,
    DEFAULT_ANDROID_API_URL,
} from './config/index.js';

dotenv.config();

class CliService {
    constructor() {
        this.program = new Command();
        this.applicationService = null;
        this.config = {};
        this.distributions = [];
        this.currentDistribution = null;
        this.setup();
    }

    /**
     * Load configuration from .xfixrc.json.
     *
     * Tolerant — a missing file or a deploy-less config is fine. Build,
     * keystore and flutter commands don't need any of it. Validation is
     * deferred until a deploy actually runs.
     */
    loadConfig() {
        try {
            const configPath = path.join(process.cwd(), '.xfixrc.json');

            if (!fs.existsSync(configPath)) {
                this.config = {};
                this.distributions = [];
                return this.distributions;
            }

            const configContent = fs.readFileSync(configPath, 'utf8');
            this.config = JSON.parse(configContent);

            if (this.config.distributions && Object.keys(this.config.distributions).length > 0) {
                this.distributions = Object.entries(this.config.distributions).map(([name, config]) => ({
                    name,
                    ...config,
                }));
            } else if (this.config.host && this.config.username) {
                this.distributions = [{ name: 'default', ...this.config }];
            } else {
                this.distributions = [];
            }

            return this.distributions;
        } catch (error) {
            console.error('⚠️  Failed to parse .xfixrc.json:', error.message);
            this.config = {};
            this.distributions = [];
            return this.distributions;
        }
    }

    /**
     * Validate all distributions have required fields.
     * No-ops for build-only projects. Throws (never exits) so callers
     * can decide how to present the failure.
     */
    validateDistributions() {
        if (this.distributions.length === 0) return;

        const requiredFields = ['host', 'username', 'password', 'remotePath', 'deployPath'];

        for (const dist of this.distributions) {
            const missing = requiredFields.filter(field => !dist[field]);
            if (missing.length > 0) {
                throw new Error(
                    `Distribution "${dist.name}" missing required fields: ${missing.join(', ')}`
                );
            }
        }
    }

    setup() {
        this.program
            .name('xfix')
            .description('XFIX CLI - Project Management & Deployment Tool')
            .version('1.0.0');

        this.loadConfig();

        this.setupRunCommand();
        this.setupDeployCommand();
        this.setupDevCommand();
        this.setupObfuscateCommand();
        this.setupRevertCommand();
        this.setupDbMigrationsCommand();
        this.setupMultiDistCommand();
        this.setupBuildCommand();
        this.setupKeystoreCommand();
        this.setupFlutterCommand();

        this.program.on('--help', () => {
            this.displayHelp();
        });
    }

    /**
     * Manage multiple distributions.
     */
    setupMultiDistCommand() {
        const multiCmd = this.program
            .command('distributions')
            .description('Manage multiple distributions');

        multiCmd
            .command('list')
            .description('List all configured distributions')
            .option('--show-markers', 'Show deployment marker status')
            .action(async (options) => {
                await this.handleListDistributions(options);
            });

        multiCmd
            .command('reset-marker <name>')
            .description('Reset deployment marker for a distribution')
            .option('--verbose', 'Enable verbose output')
            .action(async (name, options) => {
                await this.handleResetMarker(name, options);
            });

        multiCmd
            .command('status')
            .description('Show deployment status for all distributions')
            .option('--verbose', 'Show detailed status')
            .action(async (options) => {
                await this.handleDistributionsStatus(options);
            });

        multiCmd
            .command('clean-markers')
            .description('Clean up orphaned deployment markers')
            .option('--verbose', 'Enable verbose output')
            .action(async (options) => {
                await this.handleCleanMarkers(options);
            });

        multiCmd
            .command('deploy <name>')
            .description('Deploy to a specific distribution')
            .option('--secure', 'Use secure mode')
            .option('--verbose', 'Enable verbose output')
            .option('--obfuscate', 'Obfuscate files')
            .option('--include-dependencies', 'Include vendor/node_modules')
            .option('--full', 'Force full deployment')
            .option('--reset-marker', 'Reset deployment marker before deploy')
            .action(async (name, options) => {
                await this.handleDistributionDeploy(name, options);
            });

        multiCmd
            .command('deploy-all')
            .description('Deploy to all distributions')
            .option('--parallel', 'Deploy in parallel (experimental)')
            .option('--verbose', 'Enable verbose output')
            .option('--obfuscate', 'Obfuscate files')
            .option('--include-dependencies', 'Include vendor/node_modules')
            .option('--full', 'Force full deployment')
            .option('--reset-markers', 'Reset deployment markers before deploy')
            .action(async (options) => {
                await this.handleDeployAll(options);
            });

        multiCmd
            .command('validate <name>')
            .description('Validate connection to a distribution')
            .option('--verbose', 'Enable verbose output')
            .action(async (name, options) => {
                await this.handleValidateDistribution(name, options);
            });
    }

    setupRunCommand() {
        this.program
            .command('run')
            .description('Run XFIX operations (deployment, obfuscation, development tools)')
            .option('--deploy', 'Run deployment pipeline')
            .option('--distribution <name>', 'Deploy to specific distribution (multi-distribution mode)')
            .option('--all-distributions', 'Deploy to all distributions (multi-distribution mode)')
            .option('--secure', 'Use secure FTP connection and enable full obfuscation (JS & PHP)')
            .option('--verbose', 'Enable verbose output')
            .option('--obfuscate', 'Obfuscate both JS and PHP files')
            .option('--obfuscate-js', 'Obfuscate JavaScript files only')
            .option('--obfuscate-php', 'Obfuscate PHP files only')
            .option('--only-obfuscate', 'Only obfuscate without deploying (implied if --deploy not set)')
            .option('--preserve-originals', 'Preserve original files before obfuscation')
            .option('--js-src <path>', 'JavaScript source directory', 'public/js')
            .option('--js-dest <path>', 'JavaScript destination directory', 'public/orig')
            .option('--generate-controllers <controllers>', 'Generate controllers (comma-separated, development only)')
            .option('--generate-services <services>', 'Generate services (comma-separated, development only)')
            .option('--controllers <controllers>', 'Controllers to generate (alias for --generate-controllers)')
            .option('--services <services>', 'Services to generate (alias for --generate-services)')
            .option('--type <type>', 'Service type (general or migration)', 'general')
            .option('--include-dependencies', 'Include vendor/node_modules in deployment')
            .option('--include-unstaged', 'Include unstaged changes in deployment (non-secure mode only)')
            .option('--staged-only', 'Deploy only staged changes (non-secure mode only)')
            .option('--no-untracked', 'Exclude untracked files from deployment')
            .option('--full', 'Force full deployment instead of incremental')
            .action(async (options) => {
                await this.handleRunCommand(options);
            });
    }

    setupDeployCommand() {
        this.program
            .command('deploy')
            .description('Quick deployment (shorthand for "run --deploy")')
            .option('--distribution <name>', 'Deploy to specific distribution (multi-distribution mode)')
            .option('--all-distributions', 'Deploy to all distributions (multi-distribution mode)')
            .option('--secure', 'Use secure FTP connection and enable full obfuscation (JS & PHP)')
            .option('--verbose', 'Enable verbose output')
            .option('--obfuscate', 'Obfuscate both JS and PHP files (redundant with --secure)')
            .option('--obfuscate-js', 'Obfuscate JavaScript files only')
            .option('--obfuscate-php', 'Obfuscate PHP files only')
            .option('--include-dependencies', 'Include vendor/node_modules in deployment')
            .option('--include-unstaged', 'Include unstaged changes in deployment (non-secure mode only)')
            .option('--staged-only', 'Deploy only staged changes (non-secure mode only)')
            .option('--no-untracked', 'Exclude untracked files from deployment')
            .option('--full', 'Force full deployment instead of incremental')
            .action(async (options) => {
                const runOptions = {
                    ...options,
                    deploy: true,
                    obfuscateJs: options.secure ? true : (options.obfuscate || options.obfuscateJs),
                    obfuscatePhp: options.secure ? true : (options.obfuscate || options.obfuscatePhp),
                    includeDependencies: options.includeDependencies ? true : false,
                    includeUnstaged: options.includeUnstaged ? true : false,
                    includeUntracked: options.untracked !== false,
                    stagedOnly: options.stagedOnly ? true : false,
                    fullDeployment: options.full ? true : false,
                };

                await this.handleRunCommand(runOptions);
            });
    }

    setupDevCommand() {
        const devCommand = this.program
            .command('dev')
            .description('Development tools');

        const generateCommand = devCommand
            .command('generate')
            .description('Generate application components');

        generateCommand
            .command('controller <controllers...>')
            .description('Generate one or more controllers')
            .action(async (controllers) => {
                await this.handleControllerGeneration(controllers);
            });

        generateCommand
            .command('service <name...>')
            .description('Generate one or more services')
            .option('--type <type>', 'Service type (general or migration)', 'general')
            .option('--verbose', 'Enable verbose output')
            .action(async (name, options) => {
                await this.handleServiceGeneration(name, options);
            });
    }

    setupObfuscateCommand() {
        this.program
            .command('obfuscate')
            .description('Obfuscate code without deployment')
            .option('--js', 'Obfuscate JavaScript only')
            .option('--php', 'Obfuscate PHP only')
            .option('--all', 'Obfuscate both JS and PHP (default if no specific flag)')
            .option('--verbose', 'Enable verbose output')
            .option('--preserve-originals', 'Preserve original files before obfuscation')
            .option('--js-src <path>', 'JavaScript source directory', 'public/js')
            .option('--js-dest <path>', 'JavaScript destination directory', 'public/orig')
            .action(async (options) => {
                await this.handleObfuscateCommand(options);
            });
    }

    setupRevertCommand() {
        this.program
            .command('revert')
            .description('Revert obfuscated files to original versions')
            .option('--php', 'Revert PHP files only')
            .option('--js', 'Revert JavaScript files only')
            .option('--all', 'Revert both JS and PHP (default)')
            .option('--verbose', 'Enable verbose output')
            .action(async (options) => {
                await this.handleRevertCommand(options);
            });
    }

    setupDbMigrationsCommand() {
        const dbCommand = this.program
            .command('db')
            .description('Database migration management');

        dbCommand
            .command('migrate')
            .description('Run pending database migrations')
            .option('--step <n>', 'Run specific number of migrations', parseInt)
            .option('--dry-run', 'Show what would be executed without running')
            .option('--verbose', 'Enable verbose output')
            .action(async (options) => {
                await this.handleDbMigrateCommand(options);
            });

        dbCommand
            .command('rollback')
            .description('Rollback last migration or specific number of steps')
            .option('--step <n>', 'Number of migrations to rollback', parseInt, 1)
            .option('--target <name>', 'Rollback to specific migration')
            .option('--dry-run', 'Show what would be rolled back')
            .option('--verbose', 'Enable verbose output')
            .action(async (options) => {
                await this.handleDbRollbackCommand(options);
            });

        dbCommand
            .command('create <name>')
            .description('Create a new migration file')
            .option('--table <name>', 'Specify table name for the migration')
            .option('--template <type>', 'Migration template type (create, alter, drop)', 'create')
            .option('--lang <language>', 'Migration language (js or php)', 'js')
            .option('--verbose', 'Enable verbose output')
            .action(async (name, options) => {
                await this.handleDbCreateCommand(name, options);
            });

        dbCommand
            .command('status')
            .description('Show migration status (applied/pending)')
            .option('--verbose', 'Show detailed information')
            .action(async (options) => {
                await this.handleDbStatusCommand(options);
            });

        dbCommand
            .command('reset')
            .description('Rollback all migrations and run them again')
            .option('--seed', 'Run seeders after reset')
            .option('--force', 'Force reset in production')
            .option('--verbose', 'Enable verbose output')
            .action(async (options) => {
                await this.handleDbResetCommand(options);
            });

        dbCommand
            .command('seed')
            .description('Run database seeders')
            .option('--class <name>', 'Specific seeder class to run')
            .option('--force', 'Force seed in production')
            .option('--verbose', 'Enable verbose output')
            .action(async (options) => {
                await this.handleDbSeedCommand(options);
            });

        dbCommand
            .command('generate:seeder <name>')
            .description('Create a new seeder file')
            .option('--verbose', 'Enable verbose output')
            .action(async (name, options) => {
                await this.handleDbMakeSeederCommand(name, options);
            });
    }

    /**
     * Build commands (Flutter + Android signing).
     */
    setupBuildCommand() {
        const buildCmd = this.program
            .command('build')
            .description('Build mobile/desktop apps (Flutter + Android signing)');

        buildCmd
            .command('apk')
            .description('Build a signed Android APK via Flutter')
            .option('--flavor <name>', 'Flutter flavor')
            .option('--target <path>', 'Dart entrypoint (e.g. lib/main_prod.dart)')
            .option('--split-per-abi', 'Build split APKs per ABI')
            .option('--no-sign', 'Skip signing (produce unsigned APK)')
            .option('--sign-only', 'Skip build, sign existing APK')
            .option('--apk <path>', 'APK path when using --sign-only')
            .option('--keystore <path>', 'Override keystore path')
            .option('--alias <name>', 'Override key alias')
            .option('--verbose', 'Verbose output')
            .action(async (options) => {
                await this.handleBuildApk(options);
            });

        buildCmd
            .command('aab')
            .description('Build a signed Android App Bundle (AAB) via Flutter')
            .option('--flavor <name>', 'Flutter flavor')
            .option('--target <path>', 'Dart entrypoint')
            .option('--no-sign', 'Skip signing')
            .option('--verbose', 'Verbose output')
            .action(async (options) => {
                await this.handleBuildAab(options);
            });

        buildCmd
            .command('ios')
            .description('Build an iOS archive via Flutter')
            .option('--flavor <name>', 'Flutter flavor')
            .option('--target <path>', 'Dart entrypoint')
            .option('--no-codesign', 'Skip codesigning')
            .option('--verbose', 'Verbose output')
            .action(async (options) => {
                await this.handleBuildIos(options);
            });

        buildCmd
            .command('web')
            .description('Build a Flutter web bundle')
            .option('--verbose', 'Verbose output')
            .action(async (options) => {
                await this.handleBuildWeb(options);
            });

        buildCmd
            .command('doctor')
            .description('Check for required build tools (flutter, keytool, apksigner, zipalign, jarsigner)')
            .action(async () => {
                await this.handleBuildDoctor();
            });
    }

    /**
     * Keystore management (JKS).
     */
    setupKeystoreCommand() {
        const ksCmd = this.program
            .command('keystore')
            .description('Android keystore (JKS) management');

        ksCmd
            .command('provision')
            .description('Generate a keystore AND register it with the XFIX server')
            .option('--path <path>', 'Where to write the .jks (or android.keystorePath in .xfixrc.json)')
            .option('--app-id <id>', 'Application ID (or android.appId / XFIX_APP_ID)')
            .option('--alias <alias>', 'Key alias (override — default comes from the server)')
            .option('--package-name <name>', 'Android package name (override — default comes from the server)')
            .option('--dname <dname>', 'Distinguished name (override — default comes from the server)')
            .option('--storepass <password>', 'Keystore password (or ANDROID_KEYSTORE_PASSWORD)')
            .option('--validity <days>', 'Validity in days', '10000')
            .option('--api-url <url>', 'Override android.apiUrl from .xfixrc.json (base URL only)')
            .option('--skip-upload', 'Only generate the .jks locally, do not register')
            .option('--force', 'Overwrite existing .jks')
            .option('--verbose', 'Verbose output')
            .action(async (options) => {
                await this.handleKeystoreProvision(options);
            });

        ksCmd
            .command('generate')
            .description('Generate a new Android keystore file')
            .requiredOption('--path <path>', 'Output keystore path (e.g. android/app/release.jks)')
            .option('--alias <alias>', 'Key alias', 'release')
            .option('--storepass <password>', 'Keystore password (or env ANDROID_KEYSTORE_PASSWORD)')
            .option('--keypass <password>', 'Key password (defaults to --storepass)')
            .option('--dname <dname>', 'Distinguished name',
                'CN=Unknown, OU=Unknown, O=Unknown, L=Unknown, ST=Unknown, C=Unknown')
            .option('--validity <days>', 'Validity in days', '10000')
            .option('--keyalg <alg>', 'Key algorithm', 'RSA')
            .option('--keysize <bits>', 'Key size', '2048')
            .option('--force', 'Overwrite existing keystore')
            .action(async (options) => {
                await this.handleKeystoreGenerate(options);
            });

        ksCmd
            .command('info')
            .description('Show keystore information')
            .option('--path <path>', 'Keystore path (or from config)')
            .option('--storepass <password>', 'Keystore password')
            .action(async (options) => {
                await this.handleKeystoreInfo(options);
            });

        ksCmd
            .command('verify <apk>')
            .description('Verify an APK signature')
            .action(async (apk) => {
                await this.handleKeystoreVerify(apk);
            });
    }

    /**
     * Raw Flutter passthrough: xfix flutter <anything>.
     */
    setupFlutterCommand() {
        this.program
            .command('flutter')
            .description('Pass-through to Flutter CLI (e.g. xfix flutter pub get, xfix flutter doctor)')
            .allowUnknownOption(true)
            .allowExcessArguments(true)
            .action(async () => {
                const idx = process.argv.indexOf('flutter');
                const flutterArgs = idx >= 0 ? process.argv.slice(idx + 1) : [];
                await this.handleFlutterPassthrough(flutterArgs);
            });
    }

    /**
     * Handle the main 'run' command.
     */
    async handleRunCommand(options) {
        try {
            const parsedOptions = this.parseRunOptions(options);
            this.validateOptions(parsedOptions);

            if (parsedOptions.deploy) {
                this.validateDistributions();
            }

            const targetDistributions = this.getTargetDistributions(options);

            if (parsedOptions.deploy && targetDistributions.length === 0) {
                throw new Error(
                    'No distributions configured.\n' +
                    '   • Add a top-level "host"/"username"/"password"/"remotePath"/"deployPath"\n' +
                    '     or a "distributions": { ... } block to .xfixrc.json\n' +
                    '   • For build-only workflows use: xfix build, xfix keystore, xfix flutter'
                );
            }

            const isMultiDist = targetDistributions.length > 1 || this.distributions.length > 1;

            if (isMultiDist && parsedOptions.deploy) {
                await this.handleMultiDistributionDeploy(targetDistributions, parsedOptions);
            } else if (parsedOptions.deploy) {
                await this.handleSingleDistributionDeploy(targetDistributions[0], parsedOptions);
            } else if (parsedOptions.generateControllers) {
                await this.handleControllerGeneration(parsedOptions.controllers);
            } else if (parsedOptions.generateServices) {
                await this.handleServiceGeneration(parsedOptions.services, parsedOptions);
            } else if (parsedOptions.obfuscateJs || parsedOptions.obfuscatePhp) {
                await this.handleObfuscationOnly(parsedOptions);
            }

            console.log('\n✅ Operation completed successfully\n');

        } catch (err) {
            this.handleError(err, options.verbose);
        }
    }

    /**
     * Get target distributions based on options.
     */
    getTargetDistributions(options) {
        if (this.distributions.length === 0) {
            throw new Error(
                'No distributions configured.\n' +
                '   • Add a top-level "host"/"username"/"password"/"remotePath"/"deployPath"\n' +
                '     or a "distributions": { ... } block to .xfixrc.json\n' +
                '   • For build-only workflows use: xfix build, xfix keystore, xfix flutter'
            );
        }

        if (options.distribution) {
            const dist = this.distributions.find(d => d.name === options.distribution);
            if (!dist) {
                throw new Error(
                    `Distribution "${options.distribution}" not found.\n` +
                    `   Available: ${this.distributions.map(d => d.name).join(', ')}`
                );
            }
            return [dist];
        }

        if (options.allDistributions) {
            return this.distributions;
        }

        if (this.distributions.length > 1) {
            console.warn('⚠️  Multiple distributions configured but none specified');
            console.warn(`   Deploying to first distribution: ${this.distributions[0].name}`);
            console.warn('   Use --distribution <name> or --all-distributions to target specific ones');
            return [this.distributions[0]];
        }

        return this.distributions;
    }

    /**
     * Handle multi-distribution deployment.
     */
    async handleMultiDistributionDeploy(distributions, options) {
        console.log(`\n🌐 Multi-Distribution Deployment`);
        console.log('═'.repeat(50));
        console.log(`📦 Deploying to ${distributions.length} distributions\n`);

        const results = [];
        const errors = [];

        for (const dist of distributions) {
            try {
                console.log(`\n📦 Processing: ${dist.name}`);
                console.log('─'.repeat(30));

                await this.deployToDistribution(dist, options);
                results.push({ distribution: dist.name, success: true });

                console.log(`✅ ${dist.name} completed successfully`);
            } catch (error) {
                console.error(`❌ ${dist.name} failed:`, error.message);
                errors.push({ distribution: dist.name, error });

                if (distributions.length > 1) {
                    const shouldContinue = await this.promptContinue(
                        `Continue with remaining distributions?`
                    );
                    if (!shouldContinue) {
                        console.log('⏹️  Deployment aborted by user');
                        break;
                    }
                }
            }
        }

        this.displayMultiDistributionSummary(results, errors);
    }

    /**
     * Handle listing distributions with marker status.
     */
    async handleListDistributions(options) {
        console.log('\n📋 Configured Distributions');
        console.log('═'.repeat(60));

        if (this.distributions.length === 0) {
            console.log('   (none configured — build-only project)');
            console.log('');
            return;
        }

        const showMarkers = options.showMarkers || false;

        for (const dist of this.distributions) {
            console.log(`\n${dist.name}`);
            console.log(`   Host: ${dist.host}`);
            console.log(`   Path: ${dist.deployPath}`);
            console.log(`   Branch: ${dist.branch || 'develop'}`);
            console.log(`   Mode: ${dist.secure ? '🔒 Secure' : '📂 Standard'}`);

            if (showMarkers) {
                const app = new App({
                    distributionName: dist.name,
                    verbose: false,
                });

                try {
                    const status = await app.getDeployStatus();
                    console.log(`   Marker: ${status.hasDeployed ? '✅' : '❌'} ${status.hasDeployed ? status.lastHash.substring(0, 8) : 'Not deployed'}`);
                    console.log(`   Status: ${status.isUpToDate ? '✅ Up to date' : '🔄 Changes pending'}`);
                } catch (error) {
                    console.log(`   Marker: ⚠️ Error reading: ${error.message}`);
                }
            }

            if (dist.domainLock && dist.domainLock.length > 0) {
                console.log(`   Domains: ${dist.domainLock.join(', ')}`);
            }
        }

        const app = new App({});
        const markers = await app.listDeployMarkers();

        console.log(`\n📊 Summary:`);
        console.log(`   Distributions: ${this.distributions.length}`);
        console.log(`   Deploy Markers: ${markers.length}`);

        if (showMarkers) {
            console.log('\n📁 Deploy Marker Files:');
            for (const marker of markers) {
                console.log(`   • ${marker.file}`);
            }
        }

        console.log('');
    }

    /**
     * Handle resetting deployment marker.
     */
    async handleResetMarker(name, options) {
        const distribution = this.distributions.find(d => d.name === name);
        if (!distribution) {
            console.error(`❌ Distribution "${name}" not found`);
            console.log('   Available distributions:', this.distributions.map(d => d.name).join(', '));
            process.exit(1);
        }

        console.log(`\n🔄 Resetting deployment marker for: ${distribution.name}`);
        console.log('─'.repeat(40));

        const app = new App({
            distributionName: distribution.name,
            verbose: options.verbose || false,
        });

        try {
            const markerPath = app.LAST_DEPLOY_FILE;

            if (await fs.pathExists(markerPath)) {
                const content = await fs.readFile(markerPath, 'utf-8');
                console.log(`   Current marker: ${content.trim().substring(0, 8)}`);

                const confirmed = await this.promptContinue(
                    `Are you sure you want to reset the deployment marker for ${distribution.name}?`
                );

                if (!confirmed) {
                    console.log('❌ Reset cancelled');
                    return;
                }

                await app.resetDeployMarker();
                console.log(`✅ Marker reset for ${distribution.name}`);
                console.log(`   Next deployment will be a FULL deployment`);
            } else {
                console.log(`ℹ️  No marker found for ${distribution.name}`);
            }
        } catch (error) {
            console.error(`❌ Failed to reset marker: ${error.message}`);
            process.exit(1);
        }
    }

    /**
     * Handle showing deployment status for all distributions.
     */
    async handleDistributionsStatus(options) {
        console.log('\n📊 Deployment Status');
        console.log('═'.repeat(60));

        if (this.distributions.length === 0) {
            console.log('   (none configured — build-only project)');
            console.log('');
            return;
        }

        for (const dist of this.distributions) {
            console.log(`\n${dist.name}:`);
            console.log('─'.repeat(40));

            const app = new App({
                distributionName: dist.name,
                verbose: options.verbose || false,
            });

            try {
                const status = await app.getDeployStatus();

                if (status.hasDeployed) {
                    console.log(`   Last Deploy: ${status.lastHash.substring(0, 8)}`);
                    console.log(`   Current:     ${status.currentHash.substring(0, 8)}`);
                    console.log(`   Status:      ${status.isUpToDate ? '✅ Up to date' : '🔄 Changes pending'}`);

                    if (!status.isUpToDate && options.verbose) {
                        const changes = await app.getUpdatedFiles({}, {
                            includeUnstaged: false,
                            includeUntracked: false,
                            stagedOnly: false,
                            includeCommitted: true,
                        });
                        console.log(`   Changes:     ${changes.length} files`);
                    }
                } else {
                    console.log(`   Status:      ❌ Never deployed`);
                    console.log(`   Next deploy: Full deployment`);
                }

                console.log(`   Marker File: ${path.basename(app.LAST_DEPLOY_FILE)}`);

            } catch (error) {
                console.log(`   Status: ⚠️ Error: ${error.message}`);
            }
        }

        console.log(`\n📈 Summary:`);
        const app = new App({});
        const markers = await app.listDeployMarkers();
        console.log(`   Total Distributions: ${this.distributions.length}`);
        console.log(`   Deployed: ${markers.length}`);
        console.log(`   Pending:  ${this.distributions.length - markers.length}`);
        console.log('');
    }

    /**
     * Handle cleaning up orphaned markers.
     */
    async handleCleanMarkers(options) {
        console.log('\n🧹 Cleaning Orphaned Markers');
        console.log('═'.repeat(40));

        const app = new App({ verbose: options.verbose || false });
        const markers = await app.listDeployMarkers();

        const distributionNames = new Set(this.distributions.map(d => d.name));
        const orphaned = markers.filter(m => !distributionNames.has(m.distribution));

        if (orphaned.length === 0) {
            console.log('✅ No orphaned markers found');
            return;
        }

        console.log(`Found ${orphaned.length} orphaned marker(s):`);
        for (const marker of orphaned) {
            console.log(`   • ${marker.file}`);
        }

        const confirmed = await this.promptContinue(
            `Delete ${orphaned.length} orphaned marker(s)?`
        );

        if (!confirmed) {
            console.log('❌ Cleanup cancelled');
            return;
        }

        for (const marker of orphaned) {
            try {
                const markerPath = path.join(process.cwd(), marker.file);
                await fs.remove(markerPath);
                console.log(`✅ Deleted: ${marker.file}`);
            } catch (error) {
                console.log(`❌ Failed to delete ${marker.file}: ${error.message}`);
            }
        }

        console.log('\n✅ Cleanup completed');
    }

    /**
     * Deploy to a single distribution with marker handling.
     */
    async handleSingleDistributionDeploy(distribution, options) {
        console.log(`\n🚀 Deploying to: ${distribution.name}`);
        console.log('─'.repeat(40));
        console.log(`   Host: ${distribution.host}`);
        console.log(`   Path: ${distribution.deployPath}`);
        console.log('');

        if (options.resetMarker) {
            console.log(`🔄 Resetting deployment marker for ${distribution.name}...`);
            const app = new App({
                distributionName: distribution.name,
                verbose: options.verbose || false,
            });
            await app.resetDeployMarker();
            console.log('   Marker reset for full deployment\n');
        }

        const mergedOptions = this.mergeConfigWithOptions(distribution, options);
        this.displayOperationSummary(mergedOptions, distribution.name);

        this.applicationService = new App(mergedOptions);
        await this.applicationService.deploy();

        const status = await this.applicationService.getDeployStatus();
        console.log(`\n📌 Deploy marker updated to: ${status.currentHash.substring(0, 8)}`);
        console.log(`   File: ${path.basename(this.applicationService.LAST_DEPLOY_FILE)}`);
    }

    /**
     * Deploy to a single distribution.
     */
    async deployToDistribution(distribution, options) {
        const mergedOptions = this.mergeConfigWithOptions(distribution, options);

        console.log(`   Host: ${distribution.host}`);
        console.log(`   Path: ${distribution.deployPath}`);
        console.log(`   Mode: ${mergedOptions.secure ? '🔒 Secure' : '📂 Standard'}`);
        console.log(`   Marker: ${distribution.name}.last-deploy`);
        console.log('');

        const app = new App(mergedOptions);

        const status = await app.getDeployStatus();
        if (status.hasDeployed) {
            console.log(`   Last deploy: ${status.lastHash.substring(0, 8)}`);
            console.log(`   Current:     ${status.currentHash.substring(0, 8)}`);
            console.log(`   Status:      ${status.isUpToDate ? '✅ Up to date' : '🔄 Changes pending'}`);
        } else {
            console.log('   Status:      ❌ Never deployed (full deployment)');
        }
        console.log('');

        await app.deploy();

        console.log(`   ✅ ${distribution.name} deployed successfully`);
        console.log(`   📌 Marker updated: ${status.currentHash.substring(0, 8)}`);
    }

    /**
     * Merge distribution config with command options.
     */
    mergeConfigWithOptions(distribution, options) {
        return {
            protocol: distribution.protocol || 'ftp',
            host: distribution.host,
            port: distribution.port || 21,
            username: distribution.username,
            password: process.env.DEPLOY_PASSWORD || distribution.password,
            apiToken: distribution.apiToken,
            remotePath: distribution.remotePath,
            deployPath: distribution.deployPath,
            branch: distribution.branch || 'develop',
            cleanupLocal: distribution.cleanupLocal || false,
            secure: distribution.secure || false,
            rejectUnauthorized: distribution.rejectUnauthorized || false,
            readyTimeout: distribution.readyTimeout || 30000,
            retryFactor: distribution.retryFactor || 2,
            maxRetries: distribution.maxRetries || 3,
            retryDelay: distribution.retryDelay || 2000,
            retryMinTimeout: distribution.retryMinTimeout || 2000,
            deployUrl: distribution.deployUrl,
            allowBackup: distribution.allowBackup || false,
            runMigrations: distribution.runMigrations || false,
            clearCache: distribution.clearCache || false,
            runComposer: distribution.runComposer || false,
            clientId: distribution.clientId || process.env.CLIENT_ID || process.env.XFIX_CLIENT_ID || '',
            apiKey: distribution.apiKey || process.env.API_KEY || process.env.XFIX_API_KEY || '',
            obfuscateJs: distribution.obfuscateJs || false,
            obfuscatePhp: distribution.obfuscatePhp || false,
            jsSrcPath: distribution.jsSrcPath || 'public/js',
            jsDestPath: distribution.jsDestPath || 'public/orig',
            preserveOriginal: distribution.preserveOriginal || 'public/original_js_asset_folder',
            domainLock: distribution.domainLock || ['http://localhost', 'http://127.0.0.1'],
            domainLockRedirectUrl: distribution.domainLockRedirectUrl || 'http://localhost',
            exclude: distribution.exclude || ['vendor', 'node_modules', '.git', '.env'],

            verbose: options.verbose || distribution.verbose || false,
            secure: options.secure !== undefined ? options.secure : (distribution.secure || false),
            obfuscate: options.obfuscate || false,
            obfuscateJs: options.obfuscateJs !== undefined ? options.obfuscateJs : (distribution.obfuscateJs || false),
            obfuscatePhp: options.obfuscatePhp !== undefined ? options.obfuscatePhp : (distribution.obfuscatePhp || false),
            includeDependencies: options.includeDependencies !== undefined ? options.includeDependencies : false,
            includeUnstaged: options.includeUnstaged !== undefined ? options.includeUnstaged : false,
            includeUntracked: options.includeUntracked !== undefined ? options.includeUntracked : true,
            stagedOnly: options.stagedOnly !== undefined ? options.stagedOnly : false,
            fullDeployment: options.fullDeployment !== undefined ? options.fullDeployment : false,
            preserveOriginals: options.preserveOriginals || false,
            jsSrcPath: options.jsSrcPath || distribution.jsSrcPath || 'public/js',
            jsDestPath: options.jsDestPath || distribution.jsDestPath || 'public/orig',
            onlyObfuscate: options.onlyObfuscate || false,
            generateControllers: options.generateControllers || false,
            controllers: options.controllers || [],
            generateServices: options.generateServices || false,
            services: options.services || [],
            type: options.type || 'general',
            distributionName: distribution.name,
            distributionIndex: this.distributions.indexOf(distribution),
        };
    }

    /**
     * Handle distribution list (legacy).
     */
    handleListDistributionsLegacy() {
        console.log('\n📋 Configured Distributions');
        console.log('═'.repeat(50));

        if (this.distributions.length === 0) {
            console.log('   (none configured — build-only project)');
            console.log('');
            return;
        }

        this.distributions.forEach((dist, index) => {
            console.log(`\n${index + 1}. ${dist.name}`);
            console.log(`   Host: ${dist.host}`);
            console.log(`   Path: ${dist.deployPath}`);
            console.log(`   Branch: ${dist.branch || 'develop'}`);
            console.log(`   Mode: ${dist.secure ? '🔒 Secure' : '📂 Standard'}`);
            if (dist.domainLock && dist.domainLock.length > 0) {
                console.log(`   Domains: ${dist.domainLock.join(', ')}`);
            }
        });

        console.log(`\n📊 Total: ${this.distributions.length} distributions\n`);
    }

    /**
     * Handle deploying to specific distribution.
     */
    async handleDistributionDeploy(name, options) {
        this.validateDistributions();

        const distribution = this.distributions.find(d => d.name === name);
        if (!distribution) {
            console.error(`❌ Distribution "${name}" not found`);
            console.log('   Available distributions:', this.distributions.map(d => d.name).join(', '));
            process.exit(1);
        }

        await this.handleSingleDistributionDeploy(distribution, options);
    }

    /**
     * Handle deploy to all distributions.
     */
    async handleDeployAll(options) {
        this.validateDistributions();
        await this.handleMultiDistributionDeploy(this.distributions, options);
    }

    /**
     * Handle validating a distribution.
     */
    async handleValidateDistribution(name, options) {
        const distribution = this.distributions.find(d => d.name === name);
        if (!distribution) {
            console.error(`❌ Distribution "${name}" not found`);
            console.log('   Available distributions:', this.distributions.map(d => d.name).join(', '));
            process.exit(1);
        }

        console.log(`\n🔍 Validating distribution: ${distribution.name}`);
        console.log('─'.repeat(40));
        console.log(`   Host: ${distribution.host}`);
        console.log(`   Path: ${distribution.deployPath}`);
        console.log('');

        try {
            const app = new App({
                ...distribution,
                verbose: options.verbose || false,
            });

            await app.testConnection();
            console.log(`✅ Connection to ${distribution.name} successful`);
        } catch (error) {
            console.error(`❌ Connection to ${distribution.name} failed:`, error.message);
            process.exit(1);
        }
    }

    /**
     * Handle obfuscation-only.
     */
    async handleObfuscationOnly(options) {
        try {
            const obfuscateOptions = {
                verbose: options.verbose || false,
                onlyObfuscate: true,
                preserveOriginals: options.preserveOriginals || false,
                jsSrcPath: options.jsSrcPath || 'public/js',
                jsDestPath: options.jsDestPath || 'public/orig',
                obfuscateJs: options.obfuscateJs || false,
                obfuscatePhp: options.obfuscatePhp || false,
                deploy: false,
                secure: false,
            };

            console.log('\n🔒 XFIX Obfuscation:');
            if (obfuscateOptions.obfuscateJs) console.log('   📜 JavaScript: Enabled');
            if (obfuscateOptions.obfuscatePhp) console.log('   📜 PHP: Enabled');
            console.log('');

            this.applicationService = new App(obfuscateOptions);
            await this.applicationService.obfuscateOnly();

            console.log('✅ Obfuscation completed successfully\n');

        } catch (err) {
            this.handleError(err, options.verbose);
        }
    }

    /**
     * Handle obfuscate command.
     */
    async handleObfuscateCommand(options) {
        const obfuscateOptions = {
            verbose: options.verbose || false,
            onlyObfuscate: true,
            preserveOriginals: options.preserveOriginals || false,
            jsSrcPath: options.jsSrc || 'public/js',
            jsDestPath: options.jsDest || 'public/orig',
            obfuscateJs: options.all || options.js || (!options.js && !options.php),
            obfuscatePhp: options.all || options.php || (!options.js && !options.php),
            deploy: false,
            secure: false,
        };

        await this.handleObfuscationOnly(obfuscateOptions);
    }

    /**
     * Handle revert command.
     */
    async handleRevertCommand(options) {
        try {
            const shouldRevertPhp = options.all || options.php || (!options.php && !options.js);
            const shouldRevertJs = options.all || options.js || (!options.php && !options.js);

            console.log('\n🔄 XFIX Revert Operations:');
            if (shouldRevertPhp) console.log('   📜 PHP: Reverting');
            if (shouldRevertJs) console.log('   📜 JavaScript: Reverting');
            console.log('');

            const deployService = new App({ verbose: options.verbose || false });

            if (shouldRevertPhp) {
                await deployService.revert_php_obfuscation();
            }

            if (shouldRevertJs) {
                await deployService.revert_js_obfuscation();
            }

            console.log('✅ Revert completed successfully\n');

        } catch (err) {
            this.handleError(err, options.verbose);
        }
    }

    /**
     * Handle controller generation.
     */
    async handleControllerGeneration(controllers) {
        try {
            console.log('\n📝 Generating controllers...\n');

            const applicationService = new App({
                verbose: true,
                generateControllers: true,
                controllers,
            });

            await applicationService.generateControllers(controllers);

            console.log('\n✅ Controllers generated successfully\n');
        } catch (err) {
            this.handleError(err, false);
        }
    }

    /**
     * Handle service generation.
     */
    async handleServiceGeneration(services, options) {
        try {
            const serviceType = options.type || 'general';

            if (serviceType === 'migration' && services.length > 1) {
                console.error('\n❌ Cannot generate multiple migration services');
                console.log('   Migration type only supports a single service');
                console.log('   Usage: xfix dev generate service MigrationRunner --type migration');
                return;
            }

            console.log('\n⚙️  Generating Services:');
            console.log('─'.repeat(40));
            console.log(`   Type: ${serviceType === 'migration' ? 'Migration Runner' : 'General Service'}`);
            console.log(`   Services: ${services.join(', ')}`);
            console.log('');

            const applicationService = new App({
                verbose: options.verbose || false,
                generateServices: true,
                services,
                serviceType,
            });

            await applicationService.generateServices(services, serviceType);

            console.log('\n✅ Services generated successfully\n');
        } catch (err) {
            this.handleError(err, false);
        }
    }

    /**
     * Parse and normalize run options.
     */
    parseRunOptions(options) {
        const shouldDeploy = options.deploy || false;
        const isSecure = options.secure || false;

        const shouldObfuscateJs = isSecure || options.obfuscate || options.obfuscateJs || false;
        const shouldObfuscatePhp = isSecure || options.obfuscate || options.obfuscatePhp || false;

        let controllers = [];
        const controllerArg = options.generateControllers || options.controllers;
        if (controllerArg) {
            controllers = controllerArg.split(',').map(c => c.trim()).filter(Boolean);
        }

        let services = [];
        const serviceArg = options.generateServices || options.services;
        if (serviceArg) {
            services = serviceArg.split(',').map(c => c.trim()).filter(Boolean);
        }

        return {
            deploy: shouldDeploy,
            secure: isSecure,
            verbose: options.verbose || false,
            obfuscate: shouldObfuscateJs && shouldObfuscatePhp,
            obfuscateJs: shouldObfuscateJs,
            obfuscatePhp: shouldObfuscatePhp,
            onlyObfuscate: options.onlyObfuscate || (!shouldDeploy && (shouldObfuscateJs || shouldObfuscatePhp)),
            includeDependencies: options.includeDependencies || false,
            includeUnstaged: options.includeUnstaged || false,
            includeUntracked: options.includeUntracked !== false,
            stagedOnly: options.stagedOnly || false,
            fullDeployment: options.full || false,
            preserveOriginals: options.preserveOriginals || false,
            jsSrcPath: options.jsSrc || 'public/js',
            jsDestPath: options.jsDest || 'public/orig',
            generateControllers: controllers.length > 0,
            controllers,
            generateServices: services.length > 0,
            type: options.type || 'general',
            services,
        };
    }

    /**
     * Validate conflicting or invalid options.
     */
    validateOptions(options) {
        if (options.deploy && options.generateControllers && options.generateServices) {
            throw new Error(
                '❌ Conflicting options: --generate-controllers cannot be used with --deploy\n' +
                '   Controller generation is for development only.\n' +
                '   Use: xfix run --generate-controllers ControllerName\n' +
                '   Use: xfix run --generate-services ServiceName\n' +
                '   Use: xfix dev generate controller ControllerName\n' +
                '   Or:  xfix dev generate controller ControllerName'
            );
        }

        if (options.deploy && options.onlyObfuscate) {
            console.warn('⚠️  --only-obfuscate is redundant when --deploy is specified. Ignoring --only-obfuscate.');
            options.onlyObfuscate = false;
        }

        if (!options.deploy && !options.obfuscateJs && !options.obfuscatePhp &&
            !options.generateControllers && !options.generateServices) {
            throw new Error(
                '❌ No operations specified\n' +
                '   Examples:\n' +
                '     xfix run --deploy                                          # Simple deployment\n' +
                '     xfix run --deploy --secure                                 # Secure deployment with full obfuscation\n' +
                '     xfix run --deploy --obfuscate-js                           # Deploy with JS obfuscation\n' +
                '     xfix run --obfuscate-js                                    # Obfuscate JS only (no deploy)\n' +
                '     xfix run --generate-controllers User,Admin                 # Generate controllers\n' +
                '     xfix run --generate-services PaymentGateway,MailingGateway # Generate services\n' +
                '     xfix obfuscate --all                                       # Obfuscate everything\n' +
                '     xfix dev generate controller User                          # Generate a controller\n' +
                '     xfix dev generate service User                             # Generate a service'
            );
        }

        return options;
    }

    /**
     * Database command handlers.
     */
    async handleDbMigrateCommand(options) {
        try {
            console.log('\n🗄️  Database Migration:');
            console.log('─'.repeat(40));

            const migrationOptions = {
                step: options.step || null,
                dryRun: options.dryRun || false,
                verbose: options.verbose || false,
            };

            if (migrationOptions.dryRun) {
                console.log('🔍 DRY RUN MODE - No changes will be applied\n');
            }

            if (!this.applicationService) {
                this.applicationService = new App({ verbose: migrationOptions.verbose });
            }

            await this.applicationService.initDatabase();
            await this.applicationService.runMigrations(migrationOptions);

            if (migrationOptions.dryRun) {
                console.log('\n✅ Dry run completed (no changes applied)');
            } else {
                console.log('\n✅ Migrations completed successfully');
            }

        } catch (err) {
            this.handleError(err, options.verbose);
        }
    }

    async handleDbRollbackCommand(options) {
        try {
            console.log('\n⏪ Database Rollback:');
            console.log('─'.repeat(40));

            const rollbackOptions = {
                step: options.step || 1,
                target: options.target || null,
                dryRun: options.dryRun || false,
                verbose: options.verbose || false,
            };

            if (rollbackOptions.dryRun) {
                console.log('🔍 DRY RUN MODE - No changes will be applied\n');
            }

            if (!this.applicationService) {
                this.applicationService = new App({ verbose: rollbackOptions.verbose });
            }

            await this.applicationService.initDatabase();
            await this.applicationService.rollbackMigrations(rollbackOptions);

            console.log('\n✅ Rollback completed successfully');

        } catch (err) {
            this.handleError(err, options.verbose);
        }
    }

    async handleDbCreateCommand(name, options) {
        try {
            const lang = options.lang || 'js';
            const supportedLangs = ['js', 'php'];
            if (!supportedLangs.includes(lang)) {
                console.error(`\n❌ Unsupported language: ${lang}`);
                console.log(`   Supported languages: ${supportedLangs.join(', ')}`);
                return;
            }

            console.log('\n📝 Creating Migration:');
            console.log('─'.repeat(40));
            console.log(`   Language: ${lang.toUpperCase()}`);

            const createOptions = {
                name,
                table: options.table || null,
                template: options.template || 'create',
                lang,
                verbose: options.verbose || false,
            };

            if (!this.applicationService) {
                this.applicationService = new App({ verbose: createOptions.verbose });
            }

            const migrationPath = await this.applicationService.createMigration(createOptions);

            console.log(`\n✅ Migration created successfully:`);
            console.log(`   📁 ${migrationPath}`);
            console.log(`\n💡 Next steps:`);
            console.log(`   1. Edit the migration file to define your schema`);

            if (lang === 'php') {
                console.log(`   2. The migration will run automatically during deployment`);
                console.log(`   3. Or run manually via your MigrationRunner service`);
            } else {
                console.log(`   2. Run: xfix db migrate`);
                console.log(`   3. Rollback: xfix db rollback`);
            }

        } catch (err) {
            this.handleError(err, options.verbose);
        }
    }

    async handleDbStatusCommand(options) {
        try {
            console.log('\n📊 Migration Status:');
            console.log('─'.repeat(40));

            if (!this.applicationService) {
                this.applicationService = new App({ verbose: options.verbose || false });
            }

            await this.applicationService.initDatabase();
            await this.applicationService.showMigrationStatus(options.verbose || false);

        } catch (err) {
            this.handleError(err, options.verbose);
        }
    }

    async handleDbResetCommand(options) {
        try {
            console.log('\n🔄 Database Reset:');
            console.log('─'.repeat(40));

            const resetOptions = {
                seed: options.seed || false,
                force: options.force || false,
                verbose: options.verbose || false,
            };

            if (!resetOptions.force && process.env.NODE_ENV === 'production') {
                console.error('\n❌ Cannot reset database in production without --force flag');
                console.log('   Use: xfix db reset --force (if you really mean to do this)');
                process.exit(1);
            }

            if (!this.applicationService) {
                this.applicationService = new App({ verbose: resetOptions.verbose });
            }

            await this.applicationService.initDatabase();
            await this.applicationService.resetMigrations(resetOptions);

            console.log('\n✅ Database reset completed successfully');

        } catch (err) {
            this.handleError(err, options.verbose);
        }
    }

    async handleDbMakeSeederCommand(name, options) {
        try {
            console.log('\n📝 Creating Seeder:');
            console.log('─'.repeat(40));

            if (!this.applicationService) {
                this.applicationService = new App({ verbose: options.verbose || false });
            }

            const seederPath = await this.applicationService.createSeeder({
                name,
                verbose: options.verbose || false,
            });

            console.log(`\n✅ Seeder created successfully:`);
            console.log(`   📁 ${seederPath}`);
            console.log(`\n💡 Next steps:`);
            console.log(`   1. Edit the seeder file to add your data`);
            console.log(`   2. Run: xfix db seed`);
            console.log(`   3. Or run specific seeder: xfix db seed --class ${name}`);

        } catch (err) {
            this.handleError(err, options.verbose);
        }
    }

    async handleDbSeedCommand(options) {
        try {
            console.log('\n🌱 Running Seeders:');
            console.log('─'.repeat(40));

            const seedOptions = {
                seederClass: options.class || null,
                force: options.force || false,
                verbose: options.verbose || false,
            };

            if (!seedOptions.force && process.env.NODE_ENV === 'production') {
                console.error('\n❌ Cannot run seeders in production without --force flag');
                console.log('   Use: xfix db seed --force (if you really mean to do this)');
                process.exit(1);
            }

            if (!this.applicationService) {
                this.applicationService = new App({ verbose: seedOptions.verbose });
            }

            await this.applicationService.initDatabase();
            await this.applicationService.runSeeders(seedOptions);

            console.log('\n✅ Seeders completed successfully');

        } catch (err) {
            this.handleError(err, options.verbose);
        }
    }

    /**
     * xfix build apk.
     */
    async handleBuildApk(options) {
        try {
            const app = new App({ verbose: options.verbose || false });

            let apkPaths = [];

            if (!options.signOnly) {
                console.log('\n🐦 Flutter build (APK):');
                console.log('─'.repeat(40));
                apkPaths = await app.buildFlutterApk({
                    flavor: options.flavor,
                    target: options.target,
                    splitPerAbi: options.splitPerAbi,
                    verbose: options.verbose || false,
                });

                if (!apkPaths.length) {
                    throw new Error('Flutter reported success but no APK files were found under build/app/outputs/flutter-apk');
                }
                apkPaths.forEach(p => console.log(`   📦 ${path.relative(process.cwd(), p)}`));
            } else {
                if (!options.apk) {
                    throw new Error('--sign-only requires --apk <path>');
                }
                apkPaths = [path.resolve(options.apk)];
            }

            if (options.sign === false) {
                console.log('\n⏭️  Signing skipped (--no-sign)');
                return;
            }

            console.log('\n🔐 Android signing:');
            console.log('─'.repeat(40));

            for (const apk of apkPaths) {
                await app.signApk(apk, {
                    keystorePath: options.keystore,
                    keyAlias: options.alias,
                    verbose: options.verbose || false,
                });
            }

            console.log('\n✅ Build + signing completed\n');
        } catch (err) {
            this.handleError(err, options.verbose);
        }
    }

    /**
     * xfix build aab.
     */
    async handleBuildAab(options) {
        try {
            const app = new App({ verbose: options.verbose || false });

            console.log('\n🐦 Flutter build (AAB):');
            console.log('─'.repeat(40));
            const aabPath = await app.buildFlutterAab({
                flavor: options.flavor,
                target: options.target,
                verbose: options.verbose || false,
            });

            if (!aabPath) {
                throw new Error('Flutter reported success but no AAB was found under build/app/outputs/bundle');
            }
            console.log(`   📦 ${path.relative(process.cwd(), aabPath)}`);

            if (options.sign === false) {
                console.log('\n⏭️  Signing skipped (--no-sign)');
                return;
            }

            console.log('\n🔐 Signing AAB:');
            console.log('─'.repeat(40));
            await app.signAab(aabPath, { verbose: options.verbose || false });

            console.log('\n✅ AAB build + signing completed\n');
        } catch (err) {
            this.handleError(err, options.verbose);
        }
    }

    async handleBuildIos(options) {
        try {
            const app = new App({ verbose: options.verbose || false });
            console.log('\n🍎 Flutter build (iOS):');
            console.log('─'.repeat(40));
            await app.buildFlutterIos({
                flavor: options.flavor,
                target: options.target,
                codesign: options.codesign !== false,
                verbose: options.verbose || false,
            });
            console.log('\n✅ iOS build completed\n');
        } catch (err) {
            this.handleError(err, options.verbose);
        }
    }

    async handleBuildWeb(options) {
        try {
            const app = new App({ verbose: options.verbose || false });
            console.log('\n🌐 Flutter build (web):');
            console.log('─'.repeat(40));
            await app.buildFlutterWeb({ verbose: options.verbose || false });
            console.log('\n✅ Web build completed\n');
        } catch (err) {
            this.handleError(err, options.verbose);
        }
    }

    async handleBuildDoctor() {
        const app = new App({});
        console.log('\n🩺 Build tool check');
        console.log('═'.repeat(50));
        const tools = await app.checkBuildTools();

        let missing = 0;
        for (const [name, p] of Object.entries(tools)) {
            if (p) {
                console.log(`   ✅ ${name.padEnd(12)} ${p}`);
            } else {
                console.log(`   ❌ ${name.padEnd(12)} (not found)`);
                missing++;
            }
        }

        console.log('');
        if (missing) {
            console.log(`⚠️  ${missing} tool(s) missing.`);
            console.log('   - flutter:   https://docs.flutter.dev/get-started/install');
            console.log('   - keytool / jarsigner: install JDK 11+');
            console.log('   - zipalign / apksigner: install Android build-tools and set ANDROID_HOME');
            process.exit(1);
        }
        console.log('🎉 All build tools available\n');
    }

    async handleKeystoreGenerate(options) {
        try {
            const app = new App({});
            const storepass = options.storepass
                || process.env[ANDROID_ENV.keystorePassword]
                || await this.promptPassword('Keystore password: ');

            const keypass = options.keypass || storepass;

            if (!storepass) throw new Error('Keystore password is required');
            if (storepass.length < 6) throw new Error('Keystore password must be at least 6 characters');

            const out = path.resolve(options.path);

            if (await fs.pathExists(out) && !options.force) {
                console.log(`⚠️  File already exists: ${out}`);
                const ok = await this.promptContinue('Overwrite?');
                if (!ok) { console.log('Cancelled'); return; }
            }

            await fs.ensureDir(path.dirname(out));

            await app.generateKeystore({
                path: out,
                alias: options.alias,
                storepass,
                keypass,
                dname: options.dname,
                validity: options.validity,
                keyalg: options.keyalg,
                keysize: options.keysize,
            });

            console.log(`\n✅ Keystore created: ${out}`);
            console.log(`   Alias: ${options.alias}`);
            console.log('\n💡 Add to .xfixrc.json (android.keystorePath) or set env vars:');
            console.log(`   ${ANDROID_ENV.keystorePath}=${path.relative(process.cwd(), out)}`);
            console.log(`   ${ANDROID_ENV.keystorePassword}=<your password>`);
            console.log(`   ${ANDROID_ENV.keyAlias}=${options.alias}`);
        } catch (err) {
            this.handleError(err, false);
        }
    }

    /**
     * xfix keystore provision.
     *
     * Two-phase flow:
     *   1. Ask the server for the DN / alias / package name (per-app, and the
     *      DN is baked permanently into the certificate once generated).
     *   2. Generate the .jks locally with those values.
     *   3. Encode and commit it to the server so CI can fetch it later.
     *
     * Resolution order for inputs:
     *   appId:  --app-id  →  .xfixrc.json android.appId  →  .env XFIX_APP_ID  →  error
     *   path:   --path    →  .xfixrc.json android.keystorePath  →  error
     *   dname/alias/packageName: flag override → server value
     *   storepass: --storepass → env ANDROID_KEYSTORE_PASSWORD → interactive prompt
     */
    async handleKeystoreProvision(options) {
        try {
            const app = new App({ verbose: options.verbose || false });

            const cfg = await app.getAndroidConfig();

            const appId = options.appId || cfg.appId || process.env[ANDROID_ENV.appId];
            if (!appId) {
                throw new Error(
                    'No application ID specified.\n' +
                    '   Provide one of:\n' +
                    '   • --app-id <id> on the command line\n' +
                    '   • android.appId in .xfixrc.json\n' +
                    `   • ${ANDROID_ENV.appId} in .env`
                );
            }

            const outPath = options.path || cfg.keystorePath;
            if (!outPath) {
                throw new Error(
                    'No keystore path specified.\n' +
                    '   Pass --path <path>, or set android.keystorePath in .xfixrc.json'
                );
            }

            const out = path.resolve(outPath);

            console.log('\n📡 Step 1/4 — Preparing provisioning');
            console.log('─'.repeat(40));
            console.log(`   App ID:   ${appId}`);
            console.log(`   Base URL: ${cfg.apiUrl}`);

            const prep = await app.prepareSigningProvision({
                appId,
                apiUrl: options.apiUrl,
            });

            const dname = options.dname || prep.dname;
            const alias = options.alias || prep.keyAlias || 'release';
            const pkg = options.packageName || prep.packageName;

            console.log(`   DN:     ${dname}`);
            console.log(`   Alias:  ${alias}`);
            if (pkg) console.log(`   Pkg:    ${pkg}`);

            let storepass;
            if (prep.passwordOwner === 'admin') {
                storepass = prep.keystorePassword;

                if (!storepass) {
                    throw new Error(
                        'Server reported passwordOwner=admin but did not return a password.\n' +
                        '   This is a server-side bug — contact your platform administrator.'
                    );
                }

                if (storepass.length < 6) {
                    throw new Error(
                        'The administrator-set keystore password is too short.\n' +
                        `   Length: ${storepass.length}, minimum: 6 (keytool requirement)\n` +
                        '   Ask the platform administrator to update\n' +
                        '   android_keystore_password on the app row to a longer value.'
                    );
                }

                console.log('   Password: (managed by platform administrator)\n');
            } else {
                storepass = options.storepass
                    || process.env[ANDROID_ENV.keystorePassword]
                    || await this.promptPassword('Keystore password: ');

                if (!storepass) throw new Error('Keystore password is required');
                if (storepass.length < 6) throw new Error('Keystore password must be at least 6 characters');
            }

            const exists = await fs.pathExists(out);
            if (exists && !options.force) {
                console.log(`\n⚠️  ${out} already exists.`);
                const ok = await this.promptContinue('Overwrite?');
                if (!ok) { console.log('Cancelled'); return; }
            }

            await fs.ensureDir(path.dirname(out));

            console.log('\n🔑 Step 2/4 — Generating keystore');
            console.log('─'.repeat(40));
            console.log(`   Path: ${path.relative(process.cwd(), out)}`);

            await app.generateKeystore({
                path: out,
                alias,
                storepass,
                keypass: storepass,
                dname,
                validity: options.validity,
                keyalg: 'RSA',
                keysize: 2048,
            });

            console.log(`   ✅ Created: ${path.relative(process.cwd(), out)}`);

            console.log('\n📦 Step 3/4 — Encoding keystore');
            console.log('─'.repeat(40));

            const raw = await fs.readFile(out);
            const keystoreBase64 = raw.toString('base64');

            console.log(`   Size:   ${(raw.length / 1024).toFixed(1)} KB`);
            console.log(`   Base64: ${keystoreBase64.length} chars`);

            if (options.skipUpload) {
                console.log('\n⏭️  --skip-upload: file created, not registered with server.\n');
                console.log('   ⚠️  BACK UP the .jks now — the DN is baked in and cannot be changed.\n');
                return;
            }

            console.log('\n☁️  Step 4/4 — Committing to server');
            console.log('─'.repeat(40));

            const result = await app.commitSigningProvision({
                appId,
                keystoreBase64,
                keystorePassword: prep.passwordOwner === 'admin' ? null : storepass,
                keyAlias: alias,
                packageName: pkg,
                apiUrl: options.apiUrl,
            });

            console.log(`   ✅ Registered: ${result.appId}`);
            if (result.keystorePath) {
                console.log(`   Server path: ${result.keystorePath}`);
            }

            console.log('\n🎉 Provisioning complete\n');
            console.log('   Next steps:');
            console.log(`   1. Verify:   xfix keystore info --path ${path.relative(process.cwd(), out)}`);
            console.log('   2. Build:    xfix build apk --verbose');
            console.log('');
            console.log('   ⚠️  BACK UP the .jks now. Three locations:');
            console.log('      • Encrypted offline drive');
            console.log('      • Company secrets vault (1Password / Vault / AWS SM)');
            console.log('      • CI secret store');
            console.log('      If you lose it, you can never update this app on Play Store.');
            console.log('');

        } catch (err) {
            this.handleError(err, options.verbose);
        }
    }

    async handleKeystoreInfo(options) {
        try {
            const app = new App({});
            const storepass = options.storepass
                || process.env[ANDROID_ENV.keystorePassword]
                || await this.promptPassword('Keystore password: ');

            await app.showKeystoreInfo({ path: options.path, storepass });
        } catch (err) {
            this.handleError(err, false);
        }
    }

    async handleKeystoreVerify(apk) {
        try {
            const app = new App({});
            const ok = await app.verifyApk(path.resolve(apk));
            if (!ok) process.exit(1);
        } catch (err) {
            this.handleError(err, false);
        }
    }

    async handleFlutterPassthrough(args) {
        const app = new App({});
        try {
            await app.runFlutter(args);
        } catch (err) {
            process.exit(err.status || 1);
        }
    }

    async promptPassword(message) {
        const readline = await import('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true,
        });

        const stdin = process.stdin;
        const onData = (char) => {
            const s = char.toString();
            if (s === '\n' || s === '\r' || s === '\u0004') return;
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
            process.stdout.write(message + '*'.repeat(rl.line.length));
        };
        stdin.on('data', onData);

        return new Promise((resolve) => {
            rl.question(message, (answer) => {
                stdin.removeListener('data', onData);
                rl.close();
                process.stdout.write('\n');
                resolve(answer.trim());
            });
        });
    }

    /**
     * Display operation summary.
     */
    displayOperationSummary(options, distributionName = null) {
        console.log('\n🔧 XFIX Operations Summary:');
        console.log('─'.repeat(40));

        if (distributionName) {
            console.log(`📦 Distribution: ${distributionName}`);
        }

        if (options.deploy) {
            console.log('📦 Deployment:');

            if (options.secure || options.obfuscateJs || options.obfuscatePhp) {
                console.log('   • Mode: 🔒 Secure');
                if (options.obfuscateJs && options.obfuscatePhp) {
                    console.log('     ↳ 📜 JavaScript + 🐘 PHP Obfuscation');
                } else if (options.obfuscateJs) {
                    console.log('     ↳ 📜 JavaScript Obfuscation');
                } else if (options.obfuscatePhp) {
                    console.log('     ↳ 🐘 PHP Obfuscation');
                }
            } else {
                console.log('   • Mode: 📂 Standard');
            }

            if (options.fullDeployment) {
                console.log('   • Type: 📦 Full Deployment');
            } else {
                console.log('   • Type: 🔄 Incremental');
            }

            if (options.includeDependencies) {
                console.log('   • Dependencies: 📚 Including vendor/ & node_modules/');
            } else {
                console.log('   • Dependencies: ⏭️  Excluded (use --include-dependencies)');
            }

            if (options.verbose) {
                console.log('   • Output: 📊 Verbose Enabled');
            }

            console.log('');
        }

        if (options.obfuscateJs || options.obfuscatePhp) {
            console.log('🔐 Obfuscation:');
            if (options.obfuscateJs) {
                console.log('   • JavaScript: Enabled');
                console.log(`     Source: ${options.jsSrcPath}`);
                console.log(`     Destination: ${options.jsDestPath}`);
            }
            if (options.obfuscatePhp) console.log('   • PHP: Enabled');
        }

        if (options.generateControllers) {
            console.log('📝 Controller Generation:');
            options.controllers.forEach(c => console.log(`   • ${c}`));
        }

        if (options.generateServices) {
            console.log('📝 Service Generation:');
            options.services.forEach(c => console.log(`   • ${c}`));
        }

        console.log('─'.repeat(40));
        console.log('');
    }

    /**
     * Display multi-distribution summary.
     */
    displayMultiDistributionSummary(results, errors) {
        console.log('\n📊 Multi-Distribution Deployment Summary');
        console.log('═'.repeat(50));

        if (results.length > 0) {
            console.log(`\n✅ Successful: ${results.length}`);
            results.forEach(r => {
                console.log(`   • ${r.distribution}`);
            });
        }

        if (errors.length > 0) {
            console.log(`\n❌ Failed: ${errors.length}`);
            errors.forEach(e => {
                console.log(`   • ${e.distribution}: ${e.error.message || e.error}`);
            });
        }

        const total = results.length + errors.length;
        const successRate = total > 0 ? Math.round((results.length / total) * 100) : 0;
        console.log(`\n📈 Success Rate: ${successRate}% (${results.length}/${total})`);

        if (errors.length === 0 && results.length > 0) {
            console.log('🎉 All distributions deployed successfully!');
        } else if (errors.length > 0) {
            console.log('⚠️  Some distributions failed. Please check the errors above.');
        }
    }

    /**
     * Prompt user for confirmation.
     */
    async promptContinue(message) {
        const readline = await import('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        return new Promise((resolve) => {
            rl.question(`${message} (y/N): `, (answer) => {
                rl.close();
                resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
            });
        });
    }

    /**
     * Display help information.
     */
    displayHelp() {
        console.log('\n📚 XFIX CLI Help');
        console.log('═'.repeat(50));
        console.log('\n🚀 Quick Start:');
        console.log('  xfix run --deploy                    # Simple deployment');
        console.log('  xfix run --deploy --secure           # Secure deployment + full obfuscation');
        console.log('  xfix deploy --secure                 # Shorthand for above');

        if (this.distributions.length > 1) {
            console.log('\n🌐 Multi-Distribution Commands:');
            console.log('  xfix distributions list            # List all distributions');
            console.log('  xfix distributions deploy <name>   # Deploy to specific distribution');
            console.log('  xfix distributions deploy-all      # Deploy to all distributions');
            console.log('  xfix distributions validate <name> # Validate connection');
            console.log('  xfix run --deploy --distribution <name>  # Deploy to specific distribution');
            console.log('  xfix run --deploy --all-distributions   # Deploy to all distributions');
        }

        console.log('\n📋 Commands:');
        console.log('  run       Main command with multiple flags');
        console.log('  deploy    Quick deployment shorthand');
        console.log('  obfuscate Obfuscation without deployment');
        console.log('  revert    Revert obfuscated files to originals');
        console.log('  db        Database migration management');
        console.log('  dev       Development tools');
        console.log('  build     Flutter builds + Android signing');
        console.log('  keystore  Android keystore (JKS) management');
        console.log('  flutter   Raw Flutter CLI passthrough');

        console.log('\n🏴 Flags for "xfix run":');
        console.log('  --deploy              Enable deployment');
        console.log('  --secure              Secure mode (HTTPS + full obfuscation)');
        console.log('  --obfuscate           Obfuscate both JS and PHP');
        console.log('  --obfuscate-js        Obfuscate JavaScript only');
        console.log('  --obfuscate-php       Obfuscate PHP only');
        console.log('  --generate-controllers <names>  Generate controllers (dev only)');
        console.log('  --generate-services <names>  Generate services (dev only)');
        console.log('  --verbose             Show detailed output');

        console.log('\n💡 Examples:');
        console.log('  # General:');
        console.log('  xfix run --deploy --secure --verbose');
        console.log('  xfix run --deploy --secure --include-dependencies --verbose');
        console.log('  xfix deploy --secure --include-dependencies --verbose');
        console.log('  xfix obfuscate --js --verbose');
        console.log('  xfix revert --php --verbose');

        if (this.distributions.length > 1) {
            console.log('\n  # Multi-Distribution:');
            console.log('  xfix distributions list');
            console.log('  xfix distributions deploy distribution_1 --secure --verbose');
            console.log('  xfix distributions deploy-all --verbose');
            console.log('  xfix run --deploy --distribution distribution_2 --secure');
            console.log('  xfix run --deploy --all-distributions --verbose');
        }

        console.log('\n🗄️  Database Migration System:');
        console.log('─'.repeat(50));
        console.log('  db migrate              Run pending migrations');
        console.log('  db rollback             Rollback last migration(s)');
        console.log('  db create <name>        Create a new migration file');
        console.log('  db reset                Rollback all migrations and run fresh');
        console.log('  db status               Show migration status');
        console.log('  db seed                 Run database seeders');
        console.log('  db generate:seeder <name>   Create a new seeder file');

        console.log('\n💡 Examples:');
        console.log('  xfix db create create_users_table --table users');
        console.log('  xfix db migrate --step 5');
        console.log('  xfix db rollback --step 2');
        console.log('  xfix db seed --class UserSeeder');

        console.log('\n🏗️  Build & Signing:');
        console.log('─'.repeat(50));
        console.log('  build apk               Build signed Android APK (Flutter)');
        console.log('  build aab               Build signed Android App Bundle');
        console.log('  build ios               Build iOS archive');
        console.log('  build web               Build Flutter web bundle');
        console.log('  build doctor            Check build tool availability');
        console.log('  keystore provision      Generate + register a keystore with the server');
        console.log(`                          (defaults to ${DEFAULT_ANDROID_API_URL})`);
        console.log('  keystore generate       Create a new JKS keystore locally (no server)');
        console.log('  keystore info           Inspect a keystore');
        console.log('  keystore verify <apk>   Verify APK signature');
        console.log('  flutter <args>          Raw Flutter passthrough');

        console.log('\n💡 Examples:');
        console.log('  xfix build apk --flavor prod --split-per-abi');
        console.log('  xfix build aab --target lib/main_prod.dart');
        console.log('  xfix keystore provision                       # reads appId + path from .xfixrc.json');
        console.log('  xfix keystore provision --app-id app_xxx      # override app');
        console.log('  xfix keystore generate --path android/app/release.jks --alias release');
        console.log('  xfix flutter pub get');
        console.log('  xfix flutter doctor -v');
    }

    /**
     * Handle errors consistently.
     */
    handleError(err, verbose = false) {
        console.error('\n❌ Operation failed:', err.message);
        if (verbose) {
            console.error('\n📋 Stack trace:');
            console.error(err.stack);
        }
        process.exit(1);
    }

    /**
     * Parse CLI arguments and execute.
     */
    parse() {
        if (process.argv.length <= 2) {
            this.program.help();
            return;
        }

        this.program.parse(process.argv);
    }

    /**
     * Run the CLI.
     */
    run() {
        this.parse();
    }
}

export default CliService;