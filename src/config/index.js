/**
 * XFIX CLI — Static defaults and API contract.
 *
 * Anything in this file is either a fixed contract with the XFIX Workspace
 * API or a project-wide default. Anything project- or environment-specific
 * belongs in `.xfixrc.json` or a matching env var — not here.
 */

/**
 * Android signing API — fixed route suffixes.
 *
 * Combined with a base URL (android.apiUrl - XFIX_API_URL - DEFAULT) to
 * form the full endpoint. Never expose these as configurable — they are
 * part of the API contract.
 */
export const ANDROID_SIGNING_PATHS = Object.freeze({
    release:          '/api/v1/android-signing/release',
    provisionPrepare: '/api/v1/android-signing/provision/prepare',
    provisionCommit:  '/api/v1/android-signing/provision/commit',
});

export const DEFAULT_ANDROID_API_URL = 'https://api.xfixglobal.com';

/**
 * Android defaults — overridable via .xfixrc.json or env vars.
 */
export const ANDROID_DEFAULTS = Object.freeze({
    keystorePath: 'android/app/release.jks',
    keyAlias:     'release',
    timeout:      10_000,
    retries:      2,
    projectDir:   '.',
    buildType:    'release',
});

/**
 * Environment variable names — single source of truth so app.js and index.js
 * never disagree.
 */
export const ANDROID_ENV = Object.freeze({
    appId:            'XFIX_APP_ID',
    apiKey:           'XFIX_API_KEY',
    apiUrl:           'XFIX_API_URL',
    keystorePath:     'ANDROID_KEYSTORE_PATH',
    keystorePassword: 'ANDROID_KEYSTORE_PASSWORD',
    keyAlias:         'ANDROID_KEY_ALIAS',
    keyPassword:      'ANDROID_KEY_PASSWORD',
});

/**
 * Header names.
 */
export const ANDROID_HEADERS = Object.freeze({
    appId: 'XFIX-APP-ID',
});

export const DEPLOY_HEADERS = Object.freeze({
    apiKey:   'X-API-Key',
    clientId: 'XFIX-CLIENT-ID',
});

/**
 * Default Android auth block.
 *
 * Used when `.xfixrc.json` omits `android.auth`. Maps the two XFIX signing
 * headers to their conventional environment variable names, which the CLI
 * reads from `.env` (loaded via dotenv/config).
 *
 * Override in `.xfixrc.json` if your env vars use different names:
 *
 *   "android": {
 *     "auth": {
 *       "headers": {
 *         "XFIX-APP-ID":  { "env": "MY_CUSTOM_ID" },
 *         "XFIX-API-KEY": { "env": "MY_CUSTOM_KEY" }
 *       }
 *     }
 *   }
 */
export const DEFAULT_ANDROID_AUTH = Object.freeze({
    headers: {
        [ANDROID_HEADERS.appId]: { env: ANDROID_ENV.appId },
        'XFIX-API-KEY':          { env: ANDROID_ENV.apiKey },
    },
});

/**
 * HTTP / request defaults.
 */
export const HTTP_DEFAULTS = Object.freeze({
    contentType: 'application/json',
    accept:      'application/json',
});

export const USER_AGENTS = Object.freeze({
    signing:      'XFIX-Signing/1.0',
    provisioning: 'XFIX-Provision/1.0',
    deployment:   'XFIX-Deploy/1.0',
});

/**
 * Recover the base API URL from a legacy endpoint URL by stripping the
 * known Android-signing path suffix and any trailing slash.
 *
 *   https://api.foo.com/api/v1/android-signing/release             - https://api.foo.com
 *   https://api.foo.com/api/v1/android-signing/provision/prepare   - https://api.foo.com
 *   https://api.foo.com/api/v1/android-signing                     - https://api.foo.com
 *   https://api.foo.com/                                           - https://api.foo.com
 */
export function deriveBaseApiUrl(url) {
    if (!url) return null;
    return String(url)
        .replace(
            /\/api\/v1\/android-signing\/?(release|provision\/?(prepare|commit)?)?\/?$/i,
            ''
        )
        .replace(/\/+$/, '');
}

/**
 * Join a base URL with a path, tolerating stray slashes on either side.
 *
 *   joinUrl('https://api.foo.com/', '/api/v1/x') - 'https://api.foo.com/api/v1/x'
 */
export function joinUrl(base, path) {
    return String(base).replace(/\/+$/, '') + '/' + String(path).replace(/^\/+/, '');
}