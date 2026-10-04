# XFIX CLI

XFIX CLI is a command-line tool for PHP application deployment, code obfuscation, Flutter builds, Android APK/AAB signing, app store uploads, and development automation. It is built with Node.js and designed to streamline the workflow from local development to production release without requiring complex CI/CD pipelines.

## Why XFIX CLI

XFIX CLI provides a unified workflow that combines packaging, secure deployment, code protection, mobile builds, Android signing, and app store publishing into a single command interface.

It is suitable for:

- SaaS developers managing multiple deployments
- PHP developers without dedicated DevOps pipelines
- Flutter developers who need signed Android artifacts without handling keystores by hand
- Teams that need fast, repeatable release processes
- Teams that want to publish builds to their own app store without a separate CI pipeline

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

### App Store Upload

- Upload signed APK/AAB artifacts to a platform app store
- One-shot flow: build - sign - hash - upload - release - publish
- Manifest generation with Git metadata, package name, SDK levels, and per-artifact hashes
- Optional release creation with channels, rollout percentages, and scheduling
- Draft / publish / prerelease / mandatory release flags
- Rate-limit and retry aware HTTP upload
- Works against any XFIX-compatible app store backend

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
- An XFIX-compatible app store backend (app store upload only)

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

**Base URL resolution order:** `android.apiUrl` - `XFIX_API_URL` - URL derived from a legacy `credentialsApi.url` / `provisioningApi.url` - `https://api.xfixglobal.com`. The path suffixes (`/api/v1/android-signing/release`, `/provision/prepare`, `/provision/commit`) are a fixed part of the API contract and are not configurable.

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

### App store upload configuration

The app store upload uses the same base URL and auth shape as Android signing. Point it at your store backend and declare which channel builds should land on.

```json
{
  "appstore": {
    "appId": "app_your_app_identifier",
    "apiUrl": "https://api.yourdomain.com",
    "channel": "stable",
    "timeout": 1800000,

    "auth": {
      "headers": {
        "XFIX-APP-ID":  { "env": "XFIX_APP_ID" },
        "XFIX-API-KEY": { "env": "XFIX_API_KEY" }
      }
    },

    "releaseBody": {
      "title": "Gigikuyu Gitu",
      "release_notes_public": "Bug fixes and improvements"
    }
  }
}
```

Resolution rules:

- `appId` falls back to `android.appId` then `XFIX_APP_ID`.
- `apiUrl` falls back to `android.apiUrl` then `XFIX_API_URL` then the built-in default.
- `auth` falls back to `android.auth` then the built-in default.
- `channel` falls back to `android.channel`, then the built-in default `stable`.
- `releaseBody` fields are used as defaults for `--title`, `--notes`, and `--changelog`.

The `channel_slug` sent in the manifest must exist on the target application in the store backend. The set of valid channels is a server-side concern - the CLI does not create them. If the API responds with `Unknown channel slug '…'`, either the channel name is misspelled or the target application has no channels provisioned. In that case, contact the store operator or create the channels through the store's admin interface before retrying.

**Transport caveat.** If the store API sits behind Cloudflare, the free and pro plans cap request bodies at **100 MB** and kill origin requests after **100 s** (`HTTP 524`). Large APK/AAB uploads and slow store handlers will hit those limits. Route uploads through a DNS-only subdomain (grey cloud) that resolves straight to the origin. See "App store upload failures" under Troubleshooting.

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

Precedence for any value that can be set multiple ways is always **CLI flag - environment variable - `.xfixrc.json` - built-in default**.

## Configuration Options

### Deployment

| Option                | Type    | Description                                              |
| --------------------- | ------- | -------------------------------------------------------- |
| protocol              | string  | Transport:`ftp` (default), `ftps`, or `sftp`       |
| host                  | string  | FTP/FTPS/SFTP server hostname                            |
| port                  | number  | Server port. Default`21` for ftp/ftps, `22` for sftp |
| username              | string  | Login username                                           |
| password              | string  | Login password or env reference                          |
| remotePath            | string  | Remote directory the ZIP is uploaded to                  |
| deployPath            | string  | Server deploy path sent to the deploy endpoint           |
| branch                | string  | Allowed deployment branch                                |
| cleanupLocal          | boolean | Remove ZIP after upload                                  |
| secure                | boolean | Enable FTPS and full obfuscation                         |
| rejectUnauthorized    | boolean | SSL validation (ftps only)                               |
| maxRetries            | number  | Upload retry attempts                                    |
| retryDelay            | number  | Delay between retries (ms)                               |
| readyTimeout          | number  | SFTP connection timeout in ms (default`30000`)         |
| retryFactor           | number  | SFTP retry backoff factor (default`2`)                 |
| retryMinTimeout       | number  | SFTP minimum retry timeout in ms (default`2000`)       |
| verbose               | boolean | Debug logging (SFTP protocol trace when sftp)            |
| deployUrl             | string  | Deployment endpoint                                      |
| allowBackup           | boolean | Backup before deployment                                 |
| runMigrations         | boolean | Execute migrations                                       |
| clearCache            | boolean | Clear application cache                                  |
| runComposer           | boolean | Run composer install                                     |
| clientId              | string  | API client ID                                            |
| apiKey                | string  | API key                                                  |
| obfuscateJs           | boolean | Enable JS obfuscation                                    |
| obfuscatePhp          | boolean | Enable PHP obfuscation                                   |
| jsSrcPath             | string  | JS source directory                                      |
| jsDestPath            | string  | JS output directory                                      |
| preserveOriginal      | string  | Backup directory                                         |
| domainLock            | array   | Allowed domains                                          |
| domainLockRedirectUrl | string  | Redirect for blocked domains                             |
| exclude               | array   | Excluded files                                           |

### Android signing

| Option                       | Type   | Description                                                    |
| ---------------------------- | ------ | -------------------------------------------------------------- |
| android.appId                | string | Application identifier used as`XFIX-APP-ID`                  |
| android.apiUrl               | string | Base URL of the signing API (overrides anything derived below) |
| android.keystorePath         | string | Path to the local`.jks` file                                 |
| android.keyAlias             | string | Alias to sign with                                             |
| android.auth                 | object | Auth block - see "Auth shapes" above                          |
| android.releaseBody          | object | JSON body sent to the credentials endpoint                     |
| android.timeout              | number | Request timeout in ms (default`10000`)                       |
| android.retries              | number | Retry count for API calls (default`2`)                       |
| android.credentialsApi.url   | string | Legacy. Base URL derived from this when`apiUrl` is unset     |
| android.credentialsApi.auth  | object | Legacy. Used when`android.auth` is unset                     |
| android.credentialsApi.body  | object | Legacy. Used as`releaseBody` fallback                        |
| android.provisioningApi.url  | string | Legacy. Base URL derived from this when`apiUrl` is unset     |
| android.provisioningApi.auth | object | Legacy. Used when`android.auth` is unset                     |

### App store upload

| Option               | Type   | Description                                                     |
| -------------------- | ------ | --------------------------------------------------------------- |
| appstore.appId       | string | Application identifier. Falls back to`android.appId`          |
| appstore.apiUrl      | string | Store API base URL. Falls back to`android.apiUrl`             |
| appstore.channel     | string | Default channel slug for releases (default`stable`)           |
| appstore.timeout     | number | HTTP timeout in ms (default`30000`)                           |
| appstore.auth        | object | Auth block - same shapes as`android.auth`                    |
| appstore.releaseBody | object | Default values for`--title`, `--notes`, and `--changelog` |

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
- `xfix build` handles Flutter builds, Android signing, and app store uploads
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

Upload to the app store after signing:

```bash
xfix build apk --deploy
xfix build apk --deploy --verbose
xfix build apk --release --channel beta --notes "Public beta"
xfix build apk --publish --rollout 25 --mandatory
xfix build aab --release --channel production
xfix build aab --publish --prerelease
xfix build apk --deploy --app-id app_other_identifier
xfix build apk --deploy --api-url https://store.example.com
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

`--api-url` overrides `android.apiUrl` (or `XFIX_API_URL`). It is a **base URL only** - the CLI appends the fixed contract paths (`/api/v1/android-signing/provision/prepare` and `/api/v1/android-signing/provision/commit`) itself. Passing a full endpoint path will not work.

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

## App Store Upload Flow

The `--deploy`, `--release`, and `--publish` flags on `xfix build apk` and `xfix build aab` upload the signed artifact to the configured app store. The pipeline runs after signing completes.

### Flags

| Flag                   | Effect                                                           |
| ---------------------- | ---------------------------------------------------------------- |
| `--deploy`           | Upload the signed artifact to the app store                      |
| `--release`          | Upload and create a**draft** release on the target channel |
| `--publish`          | Upload, create, and**publish** in one shot                 |
| `--channel <slug>`   | Override the release channel (default:`stable`)                |
| `--app-id <id>`      | Override the target application                                  |
| `--api-url <url>`    | Override the store API base URL                                  |
| `--title <text>`     | Release title                                                    |
| `--notes <text>`     | Public release notes                                             |
| `--changelog <text>` | Changelog body                                                   |
| `--rollout <n>`      | Rollout percentage (0–100)                                      |
| `--mandatory`        | Mark release as mandatory                                        |
| `--prerelease`       | Mark release as prerelease                                       |
| `--platform <list>`  | Comma-separated platforms, e.g.`android,ios`                   |

### Stages

1. **Artifact selection.** The build command collects the signed artifact(s) from `build/app/outputs/…`. Debug builds are excluded.
2. **Hashing.** Each artifact is hashed with SHA-256; APK signatures are inspected via `apksigner` to extract the signing certificate’s SHA-256 fingerprint.
3. **Manifest generation.** A manifest is composed from the artifact hashes, the Git commit, branch, remote URL, `pubspec.yaml` version, `build.gradle` package name and SDK levels, and builder metadata.
4. **Upload.** The manifest and all artifacts are `multipart/form-data` POSTed to `POST {apiUrl}/api/v1/appstore/applications/{identifier}/builds`.
5. **Release (optional).** When `--release` or `--publish` is set, a follow-up POST creates a release on the target channel. `--publish` also flips its status to `published`.
6. **Draft fallback.** If the target channel is configured on the server to require review, the release is created as a draft regardless of `--publish`. This is a server-side policy, not a CLI one.

### Failure semantics

The build **does not fail** on app store errors. The signed artifact is already on disk. The CLI logs the failure and exits cleanly so you can retry the upload with a plain `curl` (or `xfix build apk --sign-only --apk <path> --deploy`) without rebuilding.

### Common server responses

| Status            | Meaning                     | Action                                                                                  |
| ----------------- | --------------------------- | --------------------------------------------------------------------------------------- |
| `200` / `201` | Build registered            | Done - release is optional                                                             |
| `409`           | Build hash already exists   | Rebuild to produce a new hash, or ask the store operator to clear the previous entry    |
| `413`           | Body too large              | Raise the reverse-proxy limit on the store host, or use a DNS-only upload host          |
| `422`           | Validation error            | Read`message`; fix the manifest or the store-side data it references                  |
| `500`           | Handler crash               | Ask the store operator to check the server logs                                         |
| `524`           | Origin timeout (Cloudflare) | Move uploads to a DNS-only host, or ask the operator to make the handler respond faster |

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

## Example App Store Upload Output

```
Flutter build (APK):
----------------------------------------
$ flutter build apk --release
   build/app/outputs/flutter-apk/app-release.apk (55.8MB)

Android signing:
----------------------------------------
Fetching signing credentials from API (attempt 1/3)...
Signing credentials fetched
Credentials source: api
zipalign...
apksigner...
Signed: build/app/outputs/flutter-apk/app-release.apk

App store upload:
----------------------------------------
Uploading build to https://api.xfixglobal.com/api/v1/appstore/applications/app_xxx/builds...
Build uploaded: 7b8e2d5a-1f3c-4a9e-b0c1-2d3e4f5a6b7c
Release created as draft - channel 'stable' requires review.

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

### App Store Endpoints

The store backend must expose these routes under an authenticated middleware. This is a reference shape - the CLI only cares that the paths it uses resolve correctly.

```
POST   /api/v1/appstore/applications/{identifier}/builds          # upload a build + artifacts
GET    /api/v1/appstore/applications/{identifier}/builds          # list builds

POST   /api/v1/appstore/applications/{identifier}/releases        # create a release
GET    /api/v1/appstore/applications/{identifier}/releases        # list releases

PATCH  /api/v1/appstore/releases/{uuid}/status                    # publish, pause, archive, rollback
```

The `builds` upload endpoint accepts `multipart/form-data` with two parts per artifact:

- `manifest` - JSON string. Fields: `version_name`, `version_code`, `build_hash`, `channel_slug`, `commit_sha`, `git_ref`, `git_repo`, `package_name`, `min_sdk`, `target_sdk`, `display_name`, `environment`, `built_by_name`, `builder_machine`, `cli_version`, `built_at`, `source`, `changelog`, `release_notes_public`, `release_notes_internal`, `metadata`, `artifacts[]`.
- `artifact_<n>` - the binary file, ordered to match `manifest.artifacts`.

Expected responses:

- `200` / `201` - `{ "success": true, "data": { "uuid": "…", … }, "message": "…" }`
- `4xx` - `{ "success": false, "message": "…", "errors": […] }` with an appropriate HTTP status

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

If an app store upload fails, the signed artifact remains on disk. Fix the cause of the failure and re-upload with:

```bash
xfix build apk --sign-only --apk build/app/outputs/flutter-apk/app-release.apk --deploy
```

Or upload the existing artifact with `curl` for full control over the request.

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

An `auth` block references an environment variable that is not set in the current shell. Export the variable (or add it to `.env` if you load dotenv before invoking the CLI) and re-run.

### App store upload failures

#### `413 Payload Too Large`

The store API rejected the multipart body before it reached the application handler. This is a server-side limit: the store host's reverse proxy (nginx `client_max_body_size`, Apache `LimitRequestBody`, LiteSpeed `lsapi_max_request_body_size`) or PHP (`post_max_size`, `upload_max_filesize`) is smaller than the artifact. If the API sits behind Cloudflare, note that the free and pro plans cap request bodies at **100 MB** regardless of the origin configuration. Ask the store operator to raise the limit, or route uploads through a DNS-only subdomain that bypasses the CDN entirely.

#### `524` after ~100 s

Cloudflare’s origin read timeout. The store handler took longer than 100 s to respond. Ask the operator to either move uploads to a DNS-only subdomain, or make the handler return in under a second by persisting artifacts and processing them out of band.

#### `Unknown channel slug 'stable'`

The target application has no channel provisioned under that slug. The CLI does not create channels - they are a server-side concern. Either the channel name is misspelled in your `--channel` flag or `appstore.channel` config, or the target application has no channels set up. Verify the spelling first; if that is correct, ask the store operator to provision the channel before retrying.

#### `Manifest must be valid JSON`

The store API received something other than parseable JSON in the `manifest` form field. When reproducing an upload with `curl.exe` for debugging, do not inline the manifest with escaped quotes on PowerShell - write it to a file and pass it with `<manifest.json`. The CLI itself never hits this; it serialises the manifest with `JSON.stringify`.

#### Build uploads succeed but the store never sees them

The CLI resolves the endpoint from `appstore.apiUrl` (falling back to `android.apiUrl`). Confirm the target is the store host, not the signing host. Run with `--verbose` - the CLI prints the exact URL it POSTs to.

#### Debug APK uploaded by mistake

The build command collects APKs from `build/app/outputs/flutter-apk/`. A leftover debug APK from a previous `flutter run` or `flutter build apk --debug` can be picked up alongside the release APK. The current filter excludes anything matching `-debug`, but if you see one listed in the build output, clean the directory and rebuild:

```bash
xfix flutter clean
xfix build apk --deploy
```

#### TLS altname mismatch when bypassing Cloudflare

Grey-clouding an upload subdomain sends requests straight to the origin, which must present a valid certificate for that hostname. If the origin serves its default shared-hosting certificate, Node.js refuses the connection with `Hostname/IP does not match certificate's altnames`. Ask the operator to issue a certificate for the subdomain, or use an existing hostname that already has one.

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
   |
   +---> Signed APK / AAB ---> Build Manifest ---> App Store API ---> Build ---> Release ---> Publish
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
