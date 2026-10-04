# XFIX CLI

XFIX CLI is a command-line tool for PHP application deployment, code obfuscation, Flutter builds, Android APK/AAB signing, and development automation. It is built with Node.js and designed to streamline the workflow from local development to production release without requiring complex CI/CD pipelines.

## Why XFIX CLI

XFIX CLI provides a unified workflow that combines packaging, secure deployment, code protection, mobile builds, and Android signing into a single command interface.

It is suitable for:

- SaaS developers managing multiple deployments
- PHP developers without dedicated DevOps pipelines
- Flutter developers who need signed Android artifacts without handling keystores by hand
- Teams that need fast, repeatable release processes

## Features

### Deployment

- Automated packaging into optimized ZIP archives
- FTP, FTPS, and SFTP upload with retry mechanism
- Remote deployment via HTTP endpoint
- Branch restriction to prevent unintended deployments
- File filtering using `.updateignore`
- Multi-distribution deployment from a single project
- Per-distribution deploy markers for incremental releases
- Optional secure mode with full obfuscation

### Code Obfuscation

- JavaScript obfuscation with domain locking
- PHP obfuscation using Yakpro-PO
- Selective obfuscation (JS, PHP, or both)
- Automatic backup before obfuscation
- Revert capability to restore original code

### Flutter Builds

- Android APK builds via `flutter build apk`
- Android App Bundle (AAB) builds for Play Store
- iOS archive builds
- Web bundle builds
- Raw Flutter CLI passthrough for any subcommand
- Build-tool detection (flutter, keytool, jarsigner, zipalign, apksigner)

### Android Signing

- Local JKS keystore generation
- Keystore inspection and APK signature verification
- Two-phase provisioning that registers a keystore with a platform API
- Credentials fetch API with env-var override and retry
- Automatic zipalign and apksigner (v1/v2/v3) pipeline
- AAB signing with jarsigner
- Support for API-provided keystores (no local `.jks` needed in CI)

### Development Tools

- Controller generation
- Service generation (general and migration type)
- Verbose logging for debugging
- Environment variable support
- Structured error handling

### Database Migrations

- Create, run, rollback, and reset migrations
- Seeder generation and execution
- Migration status inspection
- Support for JavaScript and PHP migration templates

## Prerequisites

- Node.js >= 18.x
- PHP >= 7.4 (for PHP obfuscation)
- Composer (for Yakpro-PO)
- FTP/FTPS or SFTP server with write access (deployment only)
- Git repository (deployment only)
- Flutter SDK (build and signing only)
- JDK 11+ (for keytool and jarsigner)
- Android SDK build-tools (for zipalign and apksigner)

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

Create a `.xfixrc.json` file in your project root. Every section is optional; the CLI only requires the sections relevant to the command you run.

### Deployment configuration (FTP / FTPS)

```json
{
  "protocol": "ftp",
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

### Deployment configuration (SFTP)

Set `protocol` to `sftp` to upload over SSH instead of FTP. Port defaults to `22`, and the SFTP-specific connection options (`readyTimeout`, `retryFactor`, `retryMinTimeout`) apply.

```json
{
  "protocol": "sftp",
  "host": "workspace.xfixglobal.com",
  "username": "deploy-user",
  "password": "${DEPLOY_PASSWORD}",
  "port": 22,
  "remotePath": "workspace.xfixglobal.com/public/store/deploy/",
  "deployPath": "workspace.xfixglobal.com/",
  "branch": "develop",
  "cleanupLocal": false,
  "secure": true,
  "rejectUnauthorized": false,
  "maxRetries": 3,
  "readyTimeout": 30000,
  "retryFactor": 2,
  "retryDelay": 2000,
  "retryMinTimeout": 2000,
  "verbose": false,
  "deployUrl": "https://xfixglobal.com/api/v1/deploy",
  "allowBackup": false,
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
    "https://workspace.xfixglobal.com",
    "https://www.workspace.xfixglobal.com"
  ],
  "domainLockRedirectUrl": "https://workspace.xfixglobal.com",
  "exclude": [
    "tests",
    "vendor.js",
    "vendor",
    "resources",
    "node_modules",
    ".git",
    ".env"
  ]
}
```

Notes on SFTP:

- `remotePath` is the directory the ZIP is uploaded into over SFTP.
- `deployPath` is passed to the remote deployment endpoint so the server knows where to extract.
- `secure: true` is still required to enable full obfuscation. It has no effect on the SFTP transport itself (SFTP is already encrypted).
- `rejectUnauthorized` is not used by the SFTP client.
- Set `verbose: true` to log SFTP protocol messages and per-file transfer progress.

### Multi-distribution configuration

Use a `distributions` block to deploy to several servers from the same project. Each distribution can use a different protocol.

```json
{
  "distributions": {
    "production": {
      "protocol": "sftp",
      "host": "workspace.xfixglobal.com",
      "username": "prod-user",
      "password": "${PROD_DEPLOY_PASSWORD}",
      "port": 22,
      "remotePath": "workspace.xfixglobal.com/public/store/deploy/",
      "deployPath": "workspace.xfixglobal.com/",
      "branch": "main"
    },
    "staging": {
      "protocol": "ftp",
      "host": "staging.yourdomain.com",
      "username": "staging-user",
      "password": "${STAGING_DEPLOY_PASSWORD}",
      "remotePath": "staging/",
      "deployPath": "staging/",
      "branch": "develop"
    }
  }
}
```

### Flutter and Android signing configuration

The preferred shape uses a single `android.apiUrl` base URL plus a shared `auth` block and an optional `releaseBody`:

```json
{
  "android": {
    "appId": "app_your_app_identifier",
    "apiUrl": "https://api.xfixglobal.com",
    "keystorePath": "android/app/release.jks",
    "keyAlias": "release",

    "auth": {
      "headers": {
        "XFIX-APP-ID":  { "env": "XFIX_APP_ID" },
        "XFIX-API-KEY": { "env": "XFIX_API_KEY" }
      }
    },

    "releaseBody": {
      "project": "your-project-slug",
      "environment": "production"
    },

    "timeout": 10000,
    "retries": 2
  },

  "flutter": {
    "projectDir": ".",
    "flavor": null
  }
}
```

The `auth` block accepts several shapes (all optional, combinable):

```json
{ "type": "bearer", "tokenEnv": "XFIX_SECRETS_TOKEN" }
{ "type": "basic",  "userEnv": "XFIX_USER", "passEnv": "XFIX_PASS" }
{ "type": "header", "headerName": "X-API-Key", "tokenEnv": "XFIX_API_KEY" }
{
  "headers": {
    "X-Tenant":      "acme",
    "XFIX-APP-ID":   { "env": "XFIX_APP_ID" },
    "XFIX-API-KEY":  { "env": "XFIX_API_KEY" },
    "Authorization": { "template": "Token ${XFIX_API_KEY}" }
  }
}
```

- `{ "env": "NAME" }` reads the header value from the given environment variable. Missing values are a hard error.
- `{ "template": "…" }` interpolates `${VAR}` placeholders from the environment. Missing values are a hard error.
- Plain strings are sent as-is.

**Base URL resolution order:** `android.apiUrl` → `XFIX_API_URL` → URL derived from a legacy `credentialsApi.url` / `provisioningApi.url` → `https://api.xfixglobal.com`. The path suffixes (`/api/v1/android-signing/release`, `/provision/prepare`, `/provision/commit`) are a fixed part of the API contract and are not configurable.

**Legacy shape (still honoured):** if your config uses `credentialsApi` and `provisioningApi`, the CLI derives the base URL from the first non-empty `url`, and uses that block's `auth` and `body` as defaults when `android.auth` / `android.releaseBody` are absent.

```json
{
  "android": {
    "appId": "app_your_app_identifier",
    "keystorePath": "android/app/release.jks",
    "keyAlias": "release",

    "credentialsApi": {
      "url": "https://api.yourcompany.com/api/v1/android-signing/release",
      "method": "POST",
      "timeout": 10000,
      "retries": 2,
      "auth": {
        "headers": {
          "XFIX-APP-ID":  { "env": "XFIX_APP_ID" },
          "XFIX-API-KEY": { "env": "XFIX_API_KEY" }
        }
      },
      "body": { "project": "your-project-slug" }
    },

    "provisioningApi": {
      "url": "https://api.yourcompany.com/api/v1/android-signing/provision",
      "auth": {
        "headers": {
          "XFIX-API-KEY": { "env": "XFIX_API_KEY" }
        }
      }
    }
  }
}
```

## Sensitive Credentials

Do not store credentials directly in `.xfixrc.json`. Use environment variables.

```bash
# Deployment
export DEPLOY_PASSWORD="your-ftp-or-sftp-password"
export CLIENT_ID="your-client-id"
export API_KEY="your-api-key"

# Android signing
export XFIX_APP_ID="app_your_app_identifier"
export XFIX_API_KEY="sk_live_..."
export XFIX_API_URL="https://api.xfixglobal.com"
export ANDROID_KEYSTORE_PASSWORD="your-keystore-password"

# Optional keystore overrides
export ANDROID_KEYSTORE_PATH="android/app/release.jks"
export ANDROID_KEY_ALIAS="release"
export ANDROID_KEY_PASSWORD="your-key-password"
```

XFIX CLI resolves these values at runtime. The `auth` blocks in `.xfixrc.json` describe which headers to send and which environment variables hold the values; the values themselves never appear in the config file.

Precedence for any value that can be set multiple ways is always **CLI flag → environment variable → `.xfixrc.json` → built-in default**.

## Configuration Options

### Deployment

| Option                | Type    | Description                                       |
| --------------------- | ------- | ------------------------------------------------- |
| protocol              | string  | Transport: `ftp` (default), `ftps`, or `sftp`     |
| host                  | string  | FTP/FTPS/SFTP server hostname                     |
| port                  | number  | Server port. Default `21` for ftp/ftps, `22` for sftp |
| username              | string  | Login username                                    |
| password              | string  | Login password or env reference                   |
| remotePath            | string  | Remote directory the ZIP is uploaded to           |
| deployPath            | string  | Server deploy path sent to the deploy endpoint    |
| branch                | string  | Allowed deployment branch                         |
| cleanupLocal          | boolean | Remove ZIP after upload                           |
| secure                | boolean | Enable FTPS and full obfuscation                  |
| rejectUnauthorized    | boolean | SSL validation (ftps only)                        |
| maxRetries            | number  | Upload retry attempts                             |
| retryDelay            | number  | Delay between retries (ms)                        |
| readyTimeout          | number  | SFTP connection timeout in ms (default `30000`)   |
| retryFactor           | number  | SFTP retry backoff factor (default `2`)           |
| retryMinTimeout       | number  | SFTP minimum retry timeout in ms (default `2000`) |
| verbose               | boolean | Debug logging (SFTP protocol trace when sftp)     |
| deployUrl             | string  | Deployment endpoint                               |
| allowBackup           | boolean | Backup before deployment                          |
| runMigrations         | boolean | Execute migrations                                |
| clearCache            | boolean | Clear application cache                           |
| runComposer           | boolean | Run composer install                              |
| clientId              | string  | API client ID                                     |
| apiKey                | string  | API key                                           |
| obfuscateJs           | boolean | Enable JS obfuscation                             |
| obfuscatePhp          | boolean | Enable PHP obfuscation                            |
| jsSrcPath             | string  | JS source directory                               |
| jsDestPath            | string  | JS output directory                               |
| preserveOriginal      | string  | Backup directory                                  |
| domainLock            | array   | Allowed domains                                   |
| domainLockRedirectUrl | string  | Redirect for blocked domains                      |
| exclude               | array   | Excluded files                                    |

### Android signing

| Option                             | Type   | Description                                                    |
| ---------------------------------- | ------ | -------------------------------------------------------------- |
| android.appId                      | string | Application identifier used as `XFIX-APP-ID`                   |
| android.apiUrl                     | string | Base URL of the signing API (overrides anything derived below) |
| android.keystorePath               | string | Path to the local `.jks` file                                  |
| android.keyAlias                   | string | Alias to sign with                                             |
| android.auth                       | object | Auth block — see "Auth shapes" above                           |
| android.releaseBody                | object | JSON body sent to the credentials endpoint                     |
| android.timeout                    | number | Request timeout in ms (default `10000`)                        |
| android.retries                    | number | Retry count for API calls (default `2`)                        |
| android.credentialsApi.url         | string | Legacy. Base URL derived from this when `apiUrl` is unset      |
| android.credentialsApi.auth        | object | Legacy. Used when `android.auth` is unset                      |
| android.credentialsApi.body        | object | Legacy. Used as `releaseBody` fallback                         |
| android.provisioningApi.url        | string | Legacy. Base URL derived from this when `apiUrl` is unset      |
| android.provisioningApi.auth       | object | Legacy. Used when `android.auth` is unset                      |

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

- `xfix run` is the base command for PHP deployments and obfuscation
- `xfix deploy` is shorthand for `xfix run --deploy`
- `xfix build` handles Flutter builds and Android signing
- `xfix keystore` manages Android JKS keystores
- `xfix db` handles database migrations and seeders
- `xfix dev` houses development generators
- `xfix flutter` passes any arguments straight to the Flutter CLI

### Deployment

```bash
xfix run --deploy
xfix deploy
xfix deploy --secure
xfix run --deploy --verbose
xfix run --deploy --include-dependencies
xfix run --deploy --full
```

Multi-distribution:

```bash
xfix distributions list
xfix distributions status
xfix distributions deploy production
xfix distributions deploy-all
xfix distributions validate production
xfix distributions reset-marker production
```

### Obfuscation

```bash
xfix obfuscate --all
xfix obfuscate --js
xfix obfuscate --php
xfix revert --all
```

### Flutter Builds

```bash
xfix build doctor
xfix build apk
xfix build apk --flavor prod --split-per-abi
xfix build apk --target lib/main_prod.dart
xfix build apk --no-sign
xfix build apk --sign-only --apk build/app/outputs/flutter-apk/app-release.apk
xfix build aab
xfix build aab --target lib/main_prod.dart
xfix build ios
xfix build ios --no-codesign
xfix build web
```

Raw Flutter passthrough:

```bash
xfix flutter pub get
xfix flutter clean
xfix flutter doctor -v
xfix flutter pub run build_runner build
```

### Android Keystore Management

```bash
xfix keystore generate --path android/app/release.jks --alias release
xfix keystore generate --path android/app/release.jks --alias release --force
xfix keystore info --path android/app/release.jks
xfix keystore verify build/app/outputs/flutter-apk/app-release.apk
```

Provision a keystore and register it with a platform API in one command:

```bash
xfix keystore provision
xfix keystore provision --app-id app_other_identifier
xfix keystore provision --skip-upload
xfix keystore provision --api-url https://api.example.com
```

`--api-url` overrides `android.apiUrl` (or `XFIX_API_URL`). It is a **base URL only** — the CLI appends the fixed contract paths (`/api/v1/android-signing/provision/prepare` and `/api/v1/android-signing/provision/commit`) itself. Passing a full endpoint path will not work.

The `provision` command runs in four phases:

1. Call the provisioning API's `prepare` endpoint to obtain the Distinguished Name, key alias, and package name for the target application. The server derives these from its own records so every app under the same organisation gets a consistent certificate identity.
2. Generate the JKS locally with those values.
3. Encode the file as base64.
4. Upload it to the provisioning API's `commit` endpoint. The server stores the file, encrypts the passwords, and links it to the application row.

App IDs resolve in this order: `--app-id` flag, then `android.appId` in `.xfixrc.json`, then the `XFIX_APP_ID` environment variable.

Keystore paths resolve in this order: `--path` flag, then `android.keystorePath` in `.xfixrc.json`, then `ANDROID_KEYSTORE_PATH`.

Passwords resolve in this order: `--storepass` flag, then the `ANDROID_KEYSTORE_PASSWORD` environment variable, then an interactive prompt. If the server reports `passwordOwner: "admin"`, the CLI uses the server-supplied value (after verifying it satisfies keytool's six-character minimum) and skips the prompt entirely.

### Database Migrations

```bash
xfix db migrate
xfix db migrate --step 5
xfix db migrate --dry-run
xfix db rollback
xfix db rollback --step 2
xfix db rollback --target 20260101_create_users_table
xfix db create create_users_table --table users
xfix db create add_status_to_orders --table orders --template alter
xfix db status
xfix db reset
xfix db reset --seed
xfix db seed
xfix db seed --class UserSeeder
xfix db generate:seeder UserSeeder
```

### Development

```bash
xfix dev generate controller UserController
xfix dev generate controller UserController AdminController
xfix dev generate service PaymentGateway EmailService
xfix dev generate service MigrationRunner --type migration
xfix dev generate service UserService RoleService PermissionService
```

## Deployment Flow

1. Load configuration
2. Validate branch
3. Apply obfuscation if enabled
4. Scan files using `.updateignore`
5. Create ZIP archive
6. Upload over the configured protocol:
   - `ftp` / `ftps` via `basic-ftp`
   - `sftp` via `ssh2-sftp-client`
7. Trigger remote deployment endpoint
8. Cleanup local artifacts
9. Log results

## Android Signing Flow

The signing pipeline depends on where the signing credentials live.

### Environment variable override

Set `ANDROID_KEYSTORE_PASSWORD` and the CLI uses it directly, bypassing the credentials API.

### Credentials API

If no environment override is present, the CLI calls the release endpoint derived from `android.apiUrl` (or its legacy equivalent) with the headers described in `android.auth`. The server responds with the keystore password, key alias, and optionally a base64-encoded copy of the keystore file. If a base64 keystore is returned, the CLI writes it to a temporary file, signs with it, and deletes the file. This is what allows CI runners to sign without a `.jks` ever existing on disk.

### Local keystore fallback

If neither the environment override nor the credentials API produces a keystore, the CLI falls back to the local file at `android.keystorePath` (or `ANDROID_KEYSTORE_PATH`).

Once credentials are resolved:

1. Build the APK or AAB with Flutter
2. Run `zipalign` on the artifact (APK only)
3. Run `apksigner` with v1, v2, and v3 signature schemes (APK)
4. Run `jarsigner` with SHA256withRSA (AAB)
5. Replace the original artifact with the signed version
6. Delete any temporary keystore file

## Example Deployment Output

```
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

## Example Signing Output

```
Flutter build (APK):
----------------------------------------
$ flutter build apk --release
...
   build/app/outputs/flutter-apk/app-release.apk

Android signing:
----------------------------------------
Fetching signing credentials from API (attempt 1/3)...
Signing credentials fetched
Credentials source: api
zipalign...
apksigner...
Signed: build/app/outputs/flutter-apk/app-release.apk

Build + signing completed
```

## Server Setup

### Deployment Endpoint

The deployment server must expose a POST endpoint such as:

```
POST /api/v1/deploy
```

Expected responsibilities:

- Validate API credentials
- Locate the uploaded ZIP file
- Extract files to the target directory
- Optionally run migrations, clear caches, or run composer install
- Return a JSON response

Example response:

```json
{
  "success": true,
  "message": "Deployment completed"
}
```

Example controller:

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

### Android Signing Endpoints

The signing server must expose three POST endpoints to support the two-phase provisioning flow and credential fetch.

```
POST /api/v1/android-signing/{profile}         # fetch signing credentials
POST /api/v1/android-signing/provision/prepare # obtain DN, alias, package name
POST /api/v1/android-signing/provision/commit  # upload generated keystore
```

The `prepare` endpoint should derive the Distinguished Name from a company settings record so the certificate identity is consistent across every application in the organisation. It must refuse to run if a keystore already exists for the application, because the DN is baked into the certificate at generation time and cannot be changed afterwards.

The `commit` endpoint should decode the base64 keystore, verify the JKS magic bytes, write the file to private storage, and update the application row. It must refuse to overwrite an existing keystore.

## Rollback Strategy

If a deployment fails:

1. Restore from the server backup
2. Revert local obfuscation:

```bash
xfix revert --all
```

3. Redeploy:

```bash
xfix deploy --secure
```

If a build or signing step fails, no artifact is published. Correct the underlying issue and re-run `xfix build`. The keystore and its credentials are not affected by build failures.

## Troubleshooting

### FTP Upload Failure (553 Can't open)

- Ensure the remote directory exists
- Verify the correct `remotePath`
- Check write permissions

### SFTP Connection Failure

- Verify `port` (default is `22` for `protocol: "sftp"`)
- Ensure the server allows password authentication, or configure key-based auth on the SFTP server
- Increase `readyTimeout` if the handshake times out on slow links
- Run with `verbose: true` to see the SFTP protocol trace
- Confirm `remotePath` exists and the SSH user has write access

### Remote Extraction Failure (HTTP 500)

- Increase `max_execution_time`
- Check server logs
- Confirm ZIP file presence

### Missing Node Module

```
Error: Cannot find a specific module
```

Fix:

```bash
npm install
# or
npm update
```

### keystoreBase64 is null

The credentials API responded successfully but the server could not locate the keystore file on disk. Check that `android_keystore_path` on the application row points at a file that exists inside the configured storage disk.

### Keystore password was incorrect

The password used to create the `.jks` does not match what the server or environment currently holds. Either the keystore was generated with a different password or the value was changed after generation. If the app has never been published to Play Store, delete the local keystore and re-run `xfix keystore provision`. If the app has been published, the keystore is the source of truth and the server value must be corrected to match it.

### Key password must be at least 6 characters

The JDK's keytool refuses passwords shorter than six characters. The value stored in the application record must be updated to a longer string before provisioning can succeed.

### Package name mismatch

Building an APK whose `applicationId` does not match the package name the server expects will cause Android to reject the update. Verify that `android/app/build.gradle` and the application record agree on the package name before uploading.

### `keystore provision --api-url` does not work

`--api-url` expects a base URL, not a full endpoint. Use `https://api.example.com`, not `https://api.example.com/api/v1/android-signing/provision`. The CLI appends the fixed contract paths itself.

### `Missing env var` / `Header "…" requires env var`

An `android.auth` block references an environment variable that is not set in the current shell. Export the variable (or add it to `.env` if you load dotenv before invoking the CLI) and re-run.

## Architecture Overview

```
Local Machine
   |
XFIX CLI
   |
   +---> FTP / FTPS / SFTP Upload (ZIP) ---> Remote Server ---> Deployment Endpoint ---> Extraction and Execution
   |
   +---> Flutter Build ---> zipalign ---> apksigner ---> Signed APK
   |
   +---> Flutter Build ---> jarsigner ---> Signed AAB
   |
   +---> Credentials API ---> Temp Keystore ---> apksigner ---> Signed APK (CI mode)
```

## Project Structure

```
xfix-cli/
|-- bin/
|-- src/
|   |-- app.js
|   |-- index.js
|   |-- config/
|   |   |-- index.js
|   |-- partials/
|-- .xfixrc.json
|-- .updateignore
|-- package.json
|-- README.md
```

## Dependencies

### Node.js

- commander
- dotenv
- fs-extra
- archiver
- basic-ftp
- ssh2-sftp-client
- execa
- node-fetch
- ignore
- glob
- fast-glob
- simple-git
- javascript-obfuscator
- mysql2
- pg
- sqlite3

### PHP

- Yakpro-PO

### External tools (for Android signing)

- keytool (JDK 11+)
- jarsigner (JDK 11+)
- zipalign (Android SDK build-tools)
- apksigner (Android SDK build-tools)

## Versioning

This project follows semantic versioning:

- MAJOR for breaking changes
- MINOR for new features
- PATCH for fixes

## License

[MIT License](https://github.com/Gicehajunior/xfix-cli/License)

## Support

Open an [issue](https://github.com/Gicehajunior/xfix-cli/issues) on the repository for bugs or feature requests.