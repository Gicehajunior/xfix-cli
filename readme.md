# XFIX CLI

XFIX CLI is a command-line tool for PHP application deployment, code obfuscation, and development automation. It is built with Node.js and designed to streamline the workflow from local development to production deployment without requiring complex CI/CD pipelines.

## Why XFIX CLI

XFIX CLI provides a unified workflow that combines packaging, secure deployment, code protection, and remote execution into a single command interface.

It is suitable for:

- SaaS developers managing multiple deployments
- PHP developers without dedicated DevOps pipelines
- Teams that need fast, repeatable deployment processes

## Features

### Deployment

- Automated packaging into optimized ZIP archives
- FTP/FTPS upload with retry mechanism
- Remote deployment via HTTP endpoint
- Branch restriction to prevent unintended deployments
- File filtering using `.updateignore`
- Optional secure mode with full obfuscation

### Code Obfuscation

- JavaScript obfuscation with domain locking
- PHP obfuscation using Yakpro-PO
- Selective obfuscation (JS, PHP, or both)
- Automatic backup before obfuscation
- Revert capability to restore original code

### Development Tools

- Controller generation
- Verbose logging for debugging
- Environment variable support
- Structured error handling

## Prerequisites

- Node.js >= 18.x
- PHP >= 7.4 (for PHP obfuscation)
- Composer (for Yakpro-PO)
- FTP/FTPS server with write access
- Git repository

## Installation

```bash
git clone https://github.com/Gicehajunior/xfix-cli.git
cd xfix-cli
npm install
npm link
composer global require pk-fr/yakpro-po
export PATH="$HOME/.composer/vendor/bin:$PATH"
```

## Configuration

Create a `.xfixrc.json` file in your project root.

```json
{
  "host": "ftp.yourdomain.com",
  "username": "your-ftp-username",
  "password": "${DEPLOY_PASSWORD}",
  "remotePath": "public_html/",
  "deployPath": "public_html/",
  "branch": "main",
  "cleanupLocal": true,
  "secure": false,
  "rejectUnauthorized": false,
  "maxRetries": 3,
  "retryDelay": 2000,
  "verbose": false,
  "deployUrl": "https://yourdomain.com",
  "allowBackup": true,
  "runMigrations": false,
  "clearCache": false,
  "runComposer": false,
  "clientId": "${CLIENT_ID}",
  "apiKey": "${API_KEY}",
  "obfuscateJs": false,
  "obfuscatePhp": false,
  "jsSrcPath": "public/js",
  "jsDestPath": "public/orig",
  "preserveOriginal": "public/original_js_asset_folder",
  "domainLock": [
    "http://localhost",
    "http://127.0.0.1",
    "https://yourdomain.com",
    "https://www.yourdomain.com"
  ],
  "domainLockRedirectUrl": "https://yourdomain.com",
  "exclude": [
    "vendor",
    "node_modules",
    ".git",
    ".env"
  ]
}
```

## Sensitive Credentials

Do not store credentials directly in `.xfixrc.json`. Use environment variables.

```bash
export DEPLOY_PASSWORD="your-password"
export CLIENT_ID="your-client-id"
export API_KEY="your-api-key"
```

XFIX CLI resolves these values at runtime.

## Configuration Options

| Option                | Type    | Description                      |
| --------------------- | ------- | -------------------------------- |
| host                  | string  | FTP server hostname              |
| username              | string  | FTP username                     |
| password              | string  | FTP password or env reference    |
| remotePath            | string  | Remote directory                 |
| deployPath            | string  | Server deploy path               |
| branch                | string  | Allowed deployment branch        |
| cleanupLocal          | boolean | Remove ZIP after upload          |
| secure                | boolean | Enable FTPS and full obfuscation |
| rejectUnauthorized    | boolean | SSL validation                   |
| maxRetries            | number  | Upload retry attempts            |
| retryDelay            | number  | Delay between retries            |
| verbose               | boolean | Debug logging                    |
| deployUrl             | string  | Deployment endpoint              |
| allowBackup           | boolean | Backup before deployment         |
| runMigrations         | boolean | Execute migrations               |
| clearCache            | boolean | Clear application cache          |
| runComposer           | boolean | Run composer install             |
| clientId              | string  | API client ID                    |
| apiKey                | string  | API key                          |
| obfuscateJs           | boolean | Enable JS obfuscation            |
| obfuscatePhp          | boolean | Enable PHP obfuscation           |
| jsSrcPath             | string  | JS source directory              |
| jsDestPath            | string  | JS output directory              |
| preserveOriginal      | string  | Backup directory                 |
| domainLock            | array   | Allowed domains                  |
| domainLockRedirectUrl | string  | Redirect for blocked domains     |
| exclude               | array   | Excluded files                   |

## .updateignore File

Define files to exclude from packaging and obfuscation.

```gitignore
node_modules/
vendor/
.git/
.env
storage/
cache/
logs/
public/storage/
public/build/
obfuscated/
deploy.zip
```

## Usage

### Command Structure

* `xfix run` is the base command
* `xfix deploy` is shorthand for `xfix run --deploy`

### Deployment

```bash
xfix run --deploy
xfix deploy
xfix deploy --secure
xfix run --deploy --verbose
```

### Obfuscation

```bash
xfix obfuscate --all
xfix obfuscate --js
xfix obfuscate --php
xfix revert --all
```

### Development

```bash
xfix dev generate controller UserController
xfix dev generate controller UserController AdminController
```

## Deployment Flow

1. Load configuration
2. Validate branch
3. Apply obfuscation if enabled
4. Scan files using `.updateignore`
5. Create ZIP archive
6. Upload via FTP/FTPS
7. Trigger remote deployment endpoint
8. Cleanup local artifacts
9. Log results

## Example Deployment Output

```bash
Connecting to server...
Connected to server
Upload attempt 1/3...
Upload failed, retrying...
Upload attempt 2/3...
Upload successful
Triggering remote deployment...
Deployment completed
Cleanup complete
```

## Server Setup

The server must expose a POST endpoint:

```
POST /v1/app/deploy
```

### Expected Responsibilities

* Validate API credentials
* Locate uploaded ZIP file
* Extract files to target directory
* Optionally run:

  * Migrations
  * Cache clearing
  * Composer install
* Return JSON response

### Example Response

```json
{
  "success": true,
  "message": "Deployment completed"
}
```

### Example Controller

```php
class DeploymentApiController
{
    public function deploy()
    {
        // Validate headers
        // Extract ZIP
        // Execute tasks

        return [
            'success' => true,
            'message' => 'Deployment completed'
        ];
    }
}
```

## Rollback Strategy

If deployment fails:

1. Restore from server backup
2. Revert local obfuscation:

```bash
xfix revert --all
```

3. Redeploy:

```bash
xfix deploy --secure
```

## Troubleshooting

### FTP Upload Failure (553 Can't open)

* Ensure remote directory exists
* Verify correct `remotePath`
* Check write permissions

### Remote Extraction Failure (HTTP 500)

* Increase `max_execution_time`
* Check server logs
* Confirm ZIP file presence

### Missing Node Module

```bash
Error: Cannot find a specific module
```

Fix:

```bash
npm install or npm update
```

## Architecture Overview

```
Local Machine
   |
XFIX CLI
   |
FTP Upload (ZIP)
   |
Remote Server
   |
Deployment Endpoint
   |
Extraction and Execution
```

## Project Structure

```
xfix-cli/
├── bin/
├── src/
├── .xfixrc.json
├── .updateignore
├── package.json
└── README.md
```

## Dependencies

### Node.js

* commander
* dotenv
* fs-extra
* archiver
* basic-ftp
* execa
* node-fetch
* ignore
* glob
* gulp
* gulp-javascript-obfuscator
* vinyl-sourcemaps-apply

### PHP

* Yakpro-PO

## Versioning

This project follows semantic versioning:

* MAJOR for breaking changes
* MINOR for new features
* PATCH for fixes

## License

[MIT License](https://github.com/Gicehajunior/xfix-cli/License)

## Support

Open an [issue](https://github.com/Gicehajunior/xfix-cli/issues). on the repository for bugs or feature requests.

```
