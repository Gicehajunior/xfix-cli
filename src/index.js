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
            .option('--controllers <controllers>', 'Controllers to generate (alias for --generate-controllers)')
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
            .action(async (options) => {
                // Deploy always implies --deploy flag
                const runOptions = {
                    ...options,
                    deploy: true,
                    // If --secure is set, force full obfuscation
                    obfuscateJs: options.secure ? true : (options.obfuscate || options.obfuscateJs),
                    obfuscatePhp: options.secure ? true : (options.obfuscate || options.obfuscatePhp)
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

            console.log('✅ Operation completed successfully\n');

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

        return {
            deploy: shouldDeploy,
            secure: isSecure,
            verbose: options.verbose || false,
            obfuscate: shouldObfuscateJs && shouldObfuscatePhp,
            obfuscateJs: shouldObfuscateJs,
            obfuscatePhp: shouldObfuscatePhp,
            onlyObfuscate: options.onlyObfuscate || (!shouldDeploy && (shouldObfuscateJs || shouldObfuscatePhp)),
            preserveOriginals: options.preserveOriginals || false,
            jsSrcPath: options.jsSrc || 'public/js',
            jsDestPath: options.jsDest || 'public/orig',
            generateControllers: controllers.length > 0,
            controllers: controllers
        };
    }

    /**
     * Validate conflicting or invalid options
     */
    validateOptions(options) {
        // --generate-controllers cannot be used with --deploy
        if (options.deploy && options.generateControllers) {
            throw new Error(
                '❌ Conflicting options: --generate-controllers cannot be used with --deploy\n' +
                '   Controller generation is for development only.\n' +
                '   Use: xfix run --generate-controllers ControllerName\n' +
                '   Or:  xfix dev generate controller ControllerName'
            );
        }

        // --only-obfuscate with --deploy makes no sense
        if (options.deploy && options.onlyObfuscate) {
            console.warn('⚠️  --only-obfuscate is redundant when --deploy is specified. Ignoring --only-obfuscate.');
            options.onlyObfuscate = false;
        }

        // If no operations specified
        if (!options.deploy && !options.obfuscateJs && !options.obfuscatePhp && !options.generateControllers) {
            throw new Error(
                '❌ No operations specified\n' +
                '   Examples:\n' +
                '     xfix run --deploy                          # Simple deployment\n' +
                '     xfix run --deploy --secure                 # Secure deployment with full obfuscation\n' +
                '     xfix run --deploy --obfuscate-js           # Deploy with JS obfuscation\n' +
                '     xfix run --obfuscate-js                    # Obfuscate JS only (no deploy)\n' +
                '     xfix run --generate-controllers User,Admin # Generate controllers\n' +
                '     xfix obfuscate --all                       # Obfuscate everything\n' +
                '     xfix dev generate controller User          # Generate a controller'
            );
        }

        return options;
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
            console.log(`   • Mode: ${options.secure ? '🔒 Secure' : '📂 Standard'}`);
            if (options.verbose) console.log('   • Verbose: Enabled');
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
        console.log('  dev       Development tools');
        
        console.log('\n🏴 Flags for "xfix run":');
        console.log('  --deploy              Enable deployment');
        console.log('  --secure              Secure mode (HTTPS + full obfuscation)');
        console.log('  --obfuscate           Obfuscate both JS and PHP');
        console.log('  --obfuscate-js        Obfuscate JavaScript only');
        console.log('  --obfuscate-php       Obfuscate PHP only');
        console.log('  --generate-controllers <names>  Generate controllers (dev only)');
        console.log('  --verbose             Show detailed output');
        
        console.log('\n💡 Examples:');
        console.log('  xfix run --deploy --secure --verbose');
        console.log('  xfix obfuscate --js --verbose');
        console.log('  xfix revert --php --verbose');
        console.log('  xfix dev generate controller UserController AdminController');
        console.log('');
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