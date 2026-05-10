import { Command } from 'commander';
import App from './app.js';
import dotenv from 'dotenv';

dotenv.config();

class CliService {
    constructor() {
        this.program = new Command();
        this.applicationService = null;
        this.setup();
    }

    setup() {
        this.program
            .name('xfix')
            .description('XFIX CLI - Project Management & Deployment Tool')
            .version('1.0.0');

        this.setupRunCommand();
        this.setupDeployCommand();
        this.setupDevCommand();
        this.setupObfuscateCommand();
        this.setupRevertCommand();
        this.setupDbMigrationsCommand();

        // Handle default help
        this.program.on('--help', () => {
            this.displayHelp();
        });
    }

    setupRunCommand() {
        this.program
            .command('run')
            .description('Run XFIX operations (deployment, obfuscation, development tools)')
            .option('--deploy', 'Run deployment pipeline')
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
                // Deploy always implies --deploy flag
                const runOptions = {
                    ...options,
                    deploy: true,
                    // If --secure is set, force full obfuscation
                    obfuscateJs: options.secure ? true : (options.obfuscate || options.obfuscateJs),
                    obfuscatePhp: options.secure ? true : (options.obfuscate || options.obfuscatePhp),
                    includeDependencies: options.includeDependencies ? true : false,
                    includeUnstaged: options.includeUnstaged ? true : false,
                    includeUntracked: options.untracked !== false, // Default true for secure mode
                    stagedOnly: options.stagedOnly ? true : false,
                    fullDeployment: options.full ? true : false
                };


                
                // Re-trigger the run command action
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

        // Create command - generate new service
        generateCommand
            .command('service <name...>')
            .description('Generate one or more controllers')
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
    

    /**
     * Handle the main 'run' command
     */
    async handleRunCommand(options) {
        try {
            // Parse options
            const parsedOptions = this.parseRunOptions(options);
            
            // Validate options
            this.validateOptions(parsedOptions);
            
            // Display operation summary
            this.displayOperationSummary(parsedOptions);
            
            // Initialize deploy service
            this.applicationService = new App(parsedOptions);
            
            // Execute based on operation type
            await this.executeOperation(parsedOptions);

            console.log(' ✅ Operation completed successfully\n');

        } catch (err) {
            this.handleError(err, options.verbose);
        }
    }

    /**
     * Handle obfuscation-only command
     */
    async handleObfuscateCommand(options) {
        try {
            const obfuscateOptions = {
                verbose: options.verbose || false,
                onlyObfuscate: true,
                preserveOriginals: options.preserveOriginals || false,
                jsSrcPath: options.jsSrc || 'public/js',
                jsDestPath: options.jsDest || 'public/orig',
                obfuscateJs: options.all || options.js || (!options.js && !options.php),
                obfuscatePhp: options.all || options.php || (!options.js && !options.php),
                // No deployment
                deploy: false,
                secure: false
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

    /**
     * Handle revert command
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
            
            // Revert PHP files
            if (shouldRevertPhp) {
                await deployService.revert_php_obfuscation();
            }
            
            // Revert JavaScript files
            if (shouldRevertJs) {
                await deployService.revert_js_obfuscation();
            }
            
            console.log('✅ Revert completed successfully\n');
            
        } catch (err) {
            this.handleError(err, options.verbose);
        }
    }    

    /**
     * Handle controller generation
     */
    async handleControllerGeneration(controllers) {
        try {
            console.log('\n📝 Generating controllers...\n');
            
            const applicationService = new App({
                verbose: true,
                generateControllers: true,
                controllers: controllers
            });
            
            await applicationService.generateControllers(controllers);
            
            console.log('\n✅ Controllers generated successfully\n');
        } catch (err) {
            this.handleError(err, false);
        }
    }

    /**
     * Handle service generation
     */
    async handleServiceGeneration(services, options) {
        try {
            const serviceType = options.type || 'general';
            
            // Validation: migration type can only generate one service
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
                services: services,
                serviceType: serviceType
            });
            
            await applicationService.generateServices(services, serviceType);
            
            console.log('\n✅ Services generated successfully\n');
        } catch (err) {
            this.handleError(err, false);
        }
    }

    /**
     * Parse and normalize run options
     */
    parseRunOptions(options) {
        const shouldDeploy = options.deploy || false;
        const isSecure = options.secure || false;
        
        // Secure mode always enables full obfuscation
        const shouldObfuscateJs = isSecure || options.obfuscate || options.obfuscateJs || false;
        const shouldObfuscatePhp = isSecure || options.obfuscate || options.obfuscatePhp || false;
        
        // Parse controllers
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

        let finalOptions = {
            deploy: shouldDeploy,
            secure: isSecure,
            verbose: options.verbose || false,
            obfuscate: shouldObfuscateJs && shouldObfuscatePhp,
            obfuscateJs: shouldObfuscateJs,
            obfuscatePhp: shouldObfuscatePhp,
            onlyObfuscate: options.onlyObfuscate || (!shouldDeploy && (shouldObfuscateJs || shouldObfuscatePhp)),
            includeDependencies: options.includeDependencies,
            includeUnstaged: options.includeUnstaged,
            includeUntracked: options.includeUntracked,
            stagedOnly: options.stagedOnly,
            fullDeployment: options.fullDeployment,
            preserveOriginals: options.preserveOriginals || false,
            jsSrcPath: options.jsSrc || 'public/js',
            jsDestPath: options.jsDest || 'public/orig',
            generateControllers: controllers.length > 0,
            controllers: controllers,
            generateServices: services.length > 0,
            type: options.type || 'general',
            services: services

        }

        const serviceType = finalOptions.type || 'general';
            
        // Validation: migration type can only generate one service
        if (serviceType === 'migration' && services.length > 1) {
            console.error('\n❌ Cannot generate multiple migration services');
            console.log('   Migration type only supports a single service');
            console.log('   Usage: xfix dev generate service MigrationRunner --type migration');
            console.log('   Usage: xfix dev generate service EmailGateway,ExportGateway,PaymentGateway');
            console.log('   Usage: xfix run --generate-services MigrationRunner --type migration');
            console.log('   OR:    xfix run --generate-services EmailGateway,ExportGateway,PaymentGateway');
            return;
        }
        
        return finalOptions;
    }

    /**
     * Validate conflicting or invalid options
     */
    validateOptions(options) {
        // --generate-controllers cannot be used with --deploy
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

        // --only-obfuscate with --deploy makes no sense
        if (options.deploy && options.onlyObfuscate) {
            console.warn('⚠️  --only-obfuscate is redundant when --deploy is specified. Ignoring --only-obfuscate.');
            options.onlyObfuscate = false;
        }

        // If no operations specified
        if (!options.deploy && !options.obfuscateJs && !options.obfuscatePhp && !options.generateControllers && !options.generateServices) {
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


    setupDbMigrationsCommand() {
        const dbCommand = this.program
            .command('db')
            .description('Database migration management');
    
        // Migrate command - run pending migrations
        dbCommand
            .command('migrate')
            .description('Run pending database migrations')
            .option('--step <n>', 'Run specific number of migrations', parseInt)
            .option('--dry-run', 'Show what would be executed without running')
            .option('--verbose', 'Enable verbose output')
            .action(async (options) => {
                await this.handleDbMigrateCommand(options);
            });
    
        // Rollback command - revert last migration(s)
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
    
        // Create command - generate new migration 
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
    
        // Status command - show migration status
        dbCommand
            .command('status')
            .description('Show migration status (applied/pending)')
            .option('--verbose', 'Show detailed information')
            .action(async (options) => {
                await this.handleDbStatusCommand(options);
            });
    
        // Reset command - rollback all and migrate fresh
        dbCommand
            .command('reset')
            .description('Rollback all migrations and run them again')
            .option('--seed', 'Run seeders after reset')
            .option('--force', 'Force reset in production')
            .option('--verbose', 'Enable verbose output')
            .action(async (options) => {
                await this.handleDbResetCommand(options);
            });
    
        // Seed command - run database seeders
        dbCommand
            .command('seed')
            .description('Run database seeders')
            .option('--class <name>', 'Specific seeder class to run')
            .option('--force', 'Force seed in production')
            .option('--verbose', 'Enable verbose output')
            .action(async (options) => {
                await this.handleDbSeedCommand(options);
            });

        // Create command - generate new seeder
        dbCommand
            .command('generate:seeder <name>')
            .description('Create a new seeder file')
            .option('--verbose', 'Enable verbose output')
            .action(async (name, options) => {
                await this.handleDbMakeSeederCommand(name, options);
            });
    }

    /**
     * Handle database migrate command
     */
    async handleDbMigrateCommand(options) {
        try {
            console.log('\n🗄️  Database Migration:');
            console.log('─'.repeat(40));
            
            const migrationOptions = {
                step: options.step || null,
                dryRun: options.dryRun || false,
                verbose: options.verbose || false
            };
            
            if (migrationOptions.dryRun) {
                console.log('🔍 DRY RUN MODE - No changes will be applied\n');
            }
            
            if (!this.applicationService) {
                this.applicationService = new App({ verbose: migrationOptions.verbose });
            }
            
            // Initialize database connection
            await this.applicationService.initDatabase();
            
            // Run migrations
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

    /**
     * Handle database rollback command
     */
    async handleDbRollbackCommand(options) {
        try {
            console.log('\n⏪ Database Rollback:');
            console.log('─'.repeat(40));
            
            const rollbackOptions = {
                step: options.step || 1,
                target: options.target || null,
                dryRun: options.dryRun || false,
                verbose: options.verbose || false
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

    /**
     * Handle database create migration command
     */
    async handleDbCreateCommand(name, options) {
        try {
            const lang = options.lang || 'js';
            
            // Validate language
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
                name: name,
                table: options.table || null,
                template: options.template || 'create',
                lang: lang,
                verbose: options.verbose || false
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

    /**
     * Handle database status command
     */
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

    /**
     * Handle database reset command
     */
    async handleDbResetCommand(options) {
        try {
            console.log('\n🔄 Database Reset:');
            console.log('─'.repeat(40));
            
            const resetOptions = {
                seed: options.seed || false,
                force: options.force || false,
                verbose: options.verbose || false
            };
            
            // Check for production confirmation
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

    /**
     * Handle database make seeder command
     */
    async handleDbMakeSeederCommand(name, options) {
        try {
            console.log('\n📝 Creating Seeder:');
            console.log('─'.repeat(40));
            
            if (!this.applicationService) {
                this.applicationService = new App({ verbose: options.verbose || false });
            }
            
            const seederPath = await this.applicationService.createSeeder({
                name: name,
                verbose: options.verbose || false
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

    /**
     * Handle database seed command
     */
    async handleDbSeedCommand(options) {
        try {
            console.log('\n🌱 Running Seeders:');
            console.log('─'.repeat(40));
            
            const seedOptions = {
                seederClass: options.class || null,
                force: options.force || false,
                verbose: options.verbose || false
            };
            
            // Check for production confirmation
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
     * Display what operations will be performed
     */
    displayOperationSummary(options) {
        console.log('\n🔧 XFIX Operations Summary:');
        console.log('─'.repeat(40));
        
        // Deployment 
        if (options.deploy) {
            console.log('📦 Deployment:');
            
            // Mode indicator
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
            
            // Deployment type
            if (options.fullDeployment) {
                console.log('   • Type: 📦 Full Deployment');
            } else {
                console.log('   • Type: 🔄 Incremental');
            }
            
            // What's being included
            if (options.includeUnstaged) {
                console.log('   • Files: ⏳ Including Unstaged Changes');
            }
            
            if (options.stagedOnly) {
                console.log('   • Files: 📋 Staged Changes Only');
            }
            
            if (options.includeDependencies) {
                console.log('   • Dependencies: 📚 Including vendor/ & node_modules/');
            } else {
                console.log('   • Dependencies: ⏭️  Excluded (use --include-dependencies)');
            }
            
            if (options.includeUntracked === false) {
                console.log('   • Files: ⏭️  Excluding Untracked Files');
            }
            
            // Verbose mode
            if (options.verbose) {
                console.log('   • Output: 📊 Verbose Enabled');
            }
            
            // Server connection
            if (options.secure) {
                console.log('   • Connection: 🔐 Secure FTP');
            } else {
                console.log('   • Connection: 📤 Standard FTP');
            }
            
            console.log('');
        }

        // Obfuscation
        if (options.obfuscateJs || options.obfuscatePhp) {
            console.log('🔐 Obfuscation:');
            if (options.obfuscateJs) {
                console.log('   • JavaScript: Enabled');
                console.log(`     Source: ${options.jsSrcPath}`);
                console.log(`     Destination: ${options.jsDestPath}`);
            }
            if (options.obfuscatePhp) console.log('   • PHP: Enabled');
            if (options.secure) console.log('   ℹ️  Full obfuscation enabled by --secure flag');
        }

        // Controller Generation
        if (options.generateControllers) {
            console.log('📝 Controller Generation:');
            options.controllers.forEach(c => console.log(`   • ${c}`));
            console.log('   ℹ️  Development mode only');
        }

        // Service Generation
        if (options.generateServices) {
            console.log('📝 Service Generation:');
            options.services.forEach(c => console.log(`   • ${c}`));
            console.log('   ℹ️  Development mode only');
        }

        // Operation mode
        if (!options.deploy && (options.obfuscateJs || options.obfuscatePhp)) {
            console.log('ℹ️  Mode: Obfuscation only (no deployment)');
        }

        console.log('─'.repeat(40));
        console.log('');
    }

    /**
     * Execute the appropriate operation
     */
    async executeOperation(options) {
        if (options.deploy) {
            // Full deployment pipeline
            await this.applicationService.deploy();
        } else if (options.generateControllers) {
            // Controller generation only
            await this.applicationService.generateControllers(options.controllers);
        } else if (options.generateServices) {
            // Controller generation only
            await this.applicationService.generateServices(options.services);
        } else if (options.obfuscateJs || options.obfuscatePhp) {
            // Obfuscation only
            await this.applicationService.obfuscateOnly();
        }
    }

    /**
     * Display help information
     */
    displayHelp() {
        console.log('\n📚 XFIX CLI Help');
        console.log('═'.repeat(50));
        console.log('\n🚀 Quick Start:');
        console.log('  xfix run --deploy                    # Simple deployment');
        console.log('  xfix run --deploy --secure           # Secure deployment + full obfuscation');
        console.log('  xfix deploy --secure                 # Shorthand for above');
        console.log('  xfix obfuscate --all                 # Obfuscate everything');
        console.log('  xfix revert --all                    # Revert obfuscated files');
        console.log('  xfix dev generate controller User    # Generate a controller');
        
        console.log('\n📋 Commands:');
        console.log('  run       Main command with multiple flags');
        console.log('  deploy    Quick deployment shorthand');
        console.log('  obfuscate Obfuscation without deployment');
        console.log('  revert    Revert obfuscated files to originals');
        console.log('  db        Database migration management');
        console.log('  dev       Development tools');
        
        console.log('\n🏴 Flags for "xfix run":');
        console.log('  --deploy              Enable deployment');
        console.log('  --secure              Secure mode (HTTPS + full obfuscation)');
        console.log('  --obfuscate           Obfuscate both JS and PHP');
        console.log('  --obfuscate-js        Obfuscate JavaScript only');
        console.log('  --obfuscate-php       Obfuscate PHP only');
        console.log('  --generate-controllers <names>  Generate controllers (dev only)');
        console.log('  --generate-services <names>  Generate services (dev only)');
        console.log('  --verbose             Show detailed output');

        console.log('\n⚙️  Development Commands:');
        console.log('  dev generate controller <names...>           Generate one or more controllers');
        console.log('  dev generate service <names...>              Generate one or more service classes');
        console.log('  dev generate service <name> --type migration Generate migration runner');
        
        console.log('\n💡 Examples:');
        console.log('  #General:');
        console.log('  xfix run --deploy --secure --verbose');
        console.log('  xfix obfuscate --js --verbose');
        console.log('  xfix revert --php --verbose');
        console.log('  xfix dev generate controller UserController AdminController');
        console.log('  xfix dev generate service User Admin');
        console.log('  ');
        console.log('  # Controllers');
        console.log('  xfix dev generate controller UserController AdminController');
        console.log('  ');
        console.log('  # Services');
        console.log('  xfix dev generate service PaymentGateway EmailService');
        console.log('  xfix dev generate service MigrationRunner --type migration');
        console.log('  ');
        console.log('  # Multiple services (general only)');
        console.log('  xfix dev generate service UserService RoleService PermissionService');
        
        console.log('');

        console.log('\n🗄️  Database Migration System:');
        console.log('─'.repeat(50));
        console.log('\n📦 Migration Commands:');
        console.log('  db migrate              Run pending migrations');
        console.log('  db rollback             Rollback last migration(s)');
        console.log('  db create <name>        Create a new migration file');
        console.log('  db reset                Rollback all migrations and run fresh');
        console.log('  db status               Show migration status');

        console.log('\n🌱 Seeder Commands:');
        console.log('  db seed                 Run database seeders');
        console.log('  db generate:seeder <name>   Create a new seeder file');
        
        console.log('\n🎯 Options:');
        console.log('  --step <n>              Number of migrations to run/rollback');
        console.log('  --target <name>         Rollback to specific migration');
        console.log('  --dry-run               Preview changes without executing');
        console.log('  --table <name>          Specify table name for migration');
        console.log('  --template <type>       Migration template (create, alter)');
        console.log('  --class <name>          Run specific seeder class');
        console.log('  --seed                  Run seeders after reset');
        console.log('  --force                 Force operation in production');
        console.log('  --verbose               Show detailed output');

        console.log('\n💡 Examples:');
        console.log('  # Migrations');
        console.log('  xfix db create <name>              Create a new migration');
        console.log('  xfix db create <name> --lang php   Create a PHP migration');
        console.log('  xfix db create <name> --table <t>  Specify table name');
        console.log('  xfix db create <name> --template <type>  Template type (create, alter, drop)');
        console.log('  xfix db migrate --step 5');
        console.log('  xfix db migrate --dry-run --verbose');
        console.log('  xfix db rollback --step 2');
        console.log('  xfix db rollback --target 20260429104650_create_users_table'); 
        console.log('  xfix db reset --seed');
        console.log('  xfix db status --verbose');

        console.log('\n💡 Examples:');
        console.log('  # JavaScript migrations (default)');
        console.log('  xfix db create create_users_table --table users');
        console.log('  xfix db create add_email_to_users --template alter --table users');
        console.log('  xfix db create create_users_table --lang js --table users');
        console.log('  ');
        console.log('  # PHP migrations');
        console.log('  xfix db create create_users_table --lang php --table users');
        console.log('  xfix db create add_email_to_users --lang php --template alter --table users');
        console.log('  xfix db create drop_old_table --lang php --template drop --table old_table');
        
        console.log('');

        console.log('\n  # Seeders');
        console.log('  xfix db seed');
        console.log('  xfix db seed --class UserSeeder');
        console.log('  xfix db seed --force --verbose');
        console.log('  xfix db generate:seeder UserSeeder');
        console.log('  xfix db generate:seeder ProductSeeder');
    }

    /**
     * Handle errors consistently
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
     * Parse CLI arguments and execute
     */
    parse() {
        // Show help if no arguments provided
        if (process.argv.length <= 2) {
            this.program.help();
            return;
        }

        this.program.parse(process.argv);
    }

    /**
     * Run the CLI
     */
    run() {
        this.parse();
    }
}

export default CliService;