import 'dotenv/config';
import fs from 'fs-extra';
import path from 'path';
import ignore from 'ignore';
import archiver from 'archiver';
import ftp from 'basic-ftp';
import SftpClient from 'ssh2-sftp-client';
import fetch from 'node-fetch';
import { execa } from 'execa';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { promisify } from 'util';
import { glob } from 'glob';
import { simpleGit } from 'simple-git';
import dns from 'node:dns/promises';
import https from 'https';
import fg from 'fast-glob';
import mysql from 'mysql2/promise';
import pg from 'pg';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import os from 'node:os';
import {
    ANDROID_SIGNING_PATHS,
    ANDROID_DEFAULTS,
    ANDROID_ENV,
    ANDROID_HEADERS,
    DEFAULT_ANDROID_AUTH,
    HTTP_DEFAULTS,
    USER_AGENTS,
    DEPLOY_HEADERS,
    DEFAULT_ANDROID_API_URL,
    deriveBaseApiUrl,
    joinUrl,
} from './config/index.js';

class App {
    constructor(options = {}) {
        this.ROOT = process.cwd();

        this.globPromise = promisify(glob);

        this.git = simpleGit(this.ROOT);

        this.distributionName = options.distributionName || 'default';
        this.LAST_DEPLOY_FILE = path.join(
            this.ROOT,
            `.last-deploy-${this.distributionName}`
        );

        this.config = {};

        this.options = {
            deploy: false,
            secure: false,
            verbose: false,

            obfuscateJs: false,
            obfuscatePhp: false,
            onlyObfuscate: false,
            preserveOriginal: false,

            includeDependencies: false,
            includeUnstaged: false,
            includeUntracked: false,
            fullDeployment: false,
            stagedOnly: false,

            jsSrcPath: 'public/js',
            jsDestPath: 'public/orig',

            domainLock: [],
            domainLockRedirectUrl: '',

            generate_controllers: false,
            controllers: [],

            total: null,
            included: null,
            excluded: null,

            distributionName: 'default',
            distributionIndex: 0,

            ...options,
        };
    }

    /**
     * Logging helper for consistent verbose output.
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
                php: '🐘',
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
            protocol: config.protocol || 'ftp',
            host: config.host,
            port: config.port || (config.protocol === 'sftp' ? 22 : 21),
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
            ftpTimeout: config.ftpTimeout || 0,
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

            obfuscateJs: this.options.obfuscateJs || config.obfuscateJs || false,
            obfuscatePhp: this.options.obfuscatePhp || config.obfuscatePhp || false,
            jsSrcPath: this.options.jsSrcPath || config.jsSrcPath || 'public/js',
            jsDestPath: this.options.jsDestPath || config.jsDestPath || 'public/orig',
            preserveOriginal: this.options.preserveOriginal
                ? (config.preserveOriginal || 'public/original_js_asset_folder')
                : null,

            domainLock: this.options.domainLock && this.options.domainLock.length > 0
                ? this.options.domainLock
                : (config.domainLock || [
                    'http://localhost',
                    'http://127.0.0.1',
                ]),
            domainLockRedirectUrl: this.options.domainLockRedirectUrl
                || config.domainLockRedirectUrl
                || 'http://localhost',

            databaseHost: config.databaseHost || process.env.DB_HOST || 'localhost',
            databaseUser: config.databaseUser || process.env.DB_USER || 'root',
            databasePassword: config.databasePassword || process.env.DB_PASSWORD || '',
            databaseName: config.databaseName || process.env.DB_NAME || 'xfix_db',
            databasePort: config.databasePort || parseInt(process.env.DB_PORT || '3306'),
            waitDatabaseForConnections: config.waitDatabaseForConnections || true,
            databaseConnectionLimit: config.databaseConnectionLimit || 10,
            databaseQueueLimit: config.databaseQueueLimit || 0,
        };

        const { address } = await dns.lookup(this.config.host, { family: 4 });

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
     * BUILD & SIGNING METHODS
     */

    /**
     * Find a binary on PATH, returns absolute path or null.
     */
    async findTool(name) {
        const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
        try {
            const out = execSync(`${cmd} ${name}`, {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore'],
            });
            const first = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
            return first || null;
        } catch {
            return null;
        }
    }

    /**
     * Locate an Android build-tool binary (zipalign, apksigner, ...).
     */
    async findAndroidBuildTool(name) {
        const onPath = await this.findTool(name);
        if (onPath) return onPath;

        const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
        if (!sdkRoot) return null;

        const buildToolsDir = path.join(sdkRoot, 'build-tools');
        if (!await fs.pathExists(buildToolsDir)) return null;

        const versions = (await fs.readdir(buildToolsDir)).sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true })
        ).reverse();

        const isWin = process.platform === 'win32';
        for (const v of versions) {
            for (const ext of isWin ? ['.bat', '.cmd', '.exe', ''] : ['']) {
                const candidate = path.join(buildToolsDir, v, `${name}${ext}`);
                if (await fs.pathExists(candidate)) return candidate;
            }
        }
        return null;
    }

    /**
     * Report which build tools are available.
     */
    async checkBuildTools() {
        const names = ['flutter', 'keytool', 'jarsigner', 'zipalign', 'apksigner'];
        const results = {};
        for (const n of names) {
            results[n] = await this.findAndroidBuildTool(n);
        }
        return results;
    }

    /**
     * Read the raw .xfixrc.json (no merging, no DNS lookups).
     */
    async getRawConfig() {
        const p = path.join(this.ROOT, '.xfixrc.json');
        if (!await fs.pathExists(p)) return {};
        try {
            return await fs.readJson(p);
        } catch {
            return {};
        }
    }

    /**
     * Resolve the Android config.
     *
     * Preferred shape:
     *   "android": {
     *     "apiUrl": "https://api.xfixglobal.com",
     *     "auth":   { "headers": { ... } },
     *     "releaseBody": { "project": "…", "environment": "production" }
     *   }
     *
     * Legacy shapes are still honoured:
     *   android.credentialsApi.url / android.provisioningApi.url
     *   android.credentialsApi.auth / android.provisioningApi.auth
     *   android.credentialsApi.body
     *
     * Base URL resolution order:
     *   android.apiUrl - env XFIX_API_URL - derived from legacy - DEFAULT_ANDROID_API_URL
     */
    async getAndroidConfig() {
        const raw = await this.getRawConfig();
        const a = raw.android || {};

        let apiUrl = (a.apiUrl || process.env[ANDROID_ENV.apiUrl] || '').trim();

        if (!apiUrl) {
            apiUrl = deriveBaseApiUrl(a.credentialsApi?.url)
                  || deriveBaseApiUrl(a.provisioningApi?.url);
        }

        if (!apiUrl) apiUrl = DEFAULT_ANDROID_API_URL;
        apiUrl = apiUrl.replace(/\/+$/, '');

        const auth = a.auth
                  || a.credentialsApi?.auth
                  || a.provisioningApi?.auth
                  || DEFAULT_ANDROID_AUTH;

        return {
            appId: process.env[ANDROID_ENV.appId] || a.appId || null,
            apiUrl,
            auth,
            timeout: a.timeout ?? ANDROID_DEFAULTS.timeout,
            retries: a.retries ?? ANDROID_DEFAULTS.retries,
            releaseBody: a.releaseBody || a.credentialsApi?.body || {},

            keystorePath: process.env[ANDROID_ENV.keystorePath]
                       || a.keystorePath
                       || ANDROID_DEFAULTS.keystorePath,
            keystorePassword: process.env[ANDROID_ENV.keystorePassword]
                           || a.keystorePassword
                           || '',
            keyAlias: process.env[ANDROID_ENV.keyAlias]
                   || a.keyAlias
                   || ANDROID_DEFAULTS.keyAlias,
            keyPassword: process.env[ANDROID_ENV.keyPassword]
                      || a.keyPassword
                      || '',
            projectDir: a.projectDir || ANDROID_DEFAULTS.projectDir,
            buildType: a.buildType || ANDROID_DEFAULTS.buildType,
        };
    }

    /**
     * Build request headers from an auth block.
     *
     * Supported shapes (all optional, combinable):
     *   "auth": { "type": "bearer",  "tokenEnv": "XFIX_SECRETS_TOKEN" }
     *   "auth": { "type": "basic",   "userEnv": "U", "passEnv": "P" }
     *   "auth": { "type": "header",  "headerName": "X-API-Key", "tokenEnv": "K" }
     *   "auth": {
     *     "headers": {
     *       "XFIX-APP-ID":  { "env": "XFIX_APP_ID" },
     *       "XFIX-API-KEY": { "env": "XFIX_API_KEY" },
     *       "X-Tenant":     "acme",
     *       "Authorization": { "template": "Token ${XFIX_API_KEY}" }
     *     }
     *   }
     */
    _resolveAuthHeaders(auth) {
        const out = {};
        if (!auth) return out;

        if (auth.type === 'bearer') {
            const token = auth.tokenEnv ? process.env[auth.tokenEnv] : null;
            if (!token) {
                throw new Error(
                    `Signing API uses bearer auth but env var ${auth.tokenEnv} is not set`
                );
            }
            out['Authorization'] = `Bearer ${token}`;
        }

        if (auth.type === 'basic') {
            const user = auth.userEnv ? process.env[auth.userEnv] : null;
            const pass = auth.passEnv ? process.env[auth.passEnv] : null;
            if (!user) throw new Error(`Missing env var ${auth.userEnv} for basic auth`);
            if (!pass) throw new Error(`Missing env var ${auth.passEnv} for basic auth`);
            out['Authorization'] =
                `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
        }

        if (auth.type === 'header') {
            const token = auth.tokenEnv ? process.env[auth.tokenEnv] : null;
            if (!token) {
                throw new Error(
                    `Signing API uses header auth but env var ${auth.tokenEnv} is not set`
                );
            }
            out[auth.headerName || 'X-API-Key'] = token;
        }

        if (auth.headers && typeof auth.headers === 'object') {
            for (const [name, spec] of Object.entries(auth.headers)) {
                out[name] = this._resolveHeaderValue(name, spec);
            }
        }

        return out;
    }

    /**
     * Resolve a single header value from a literal string, { env }, or { template }.
     */
    _resolveHeaderValue(name, spec) {
        if (typeof spec === 'string') return spec;

        if (typeof spec !== 'object' || spec === null) {
            throw new Error(
                `Header "${name}" must be a string, { env }, or { template }`
            );
        }

        if (spec.env) {
            const v = process.env[spec.env];
            if (v === undefined || v === '') {
                throw new Error(
                    `Header "${name}" requires env var "${spec.env}" which is not set`
                );
            }
            return v;
        }

        if (spec.template) {
            return spec.template.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, varName) => {
                const v = process.env[varName];
                if (v === undefined || v === '') {
                    throw new Error(
                        `Header "${name}" template references env var "${varName}" which is not set`
                    );
                }
                return v;
            });
        }

        throw new Error(
            `Header "${name}" must specify either { env } or { template }`
        );
    }

    /**
     * Fetch signing credentials from the configured signing API.
     * Caches per App instance.
     */
    async fetchSigningCredentials() {
        if (this._signingCredentials !== undefined) return this._signingCredentials;

        const cfg = await this.getAndroidConfig();

        if (!cfg.apiUrl) {
            this._signingCredentials = null;
            return null;
        }

        const url = joinUrl(cfg.apiUrl, ANDROID_SIGNING_PATHS.release);
        const timeout = cfg.timeout;
        const retries = cfg.retries;

        const headers = {
            'Content-Type': HTTP_DEFAULTS.contentType,
            'Accept': HTTP_DEFAULTS.accept,
            'User-Agent': USER_AGENTS.signing,
        };
        Object.assign(headers, this._resolveAuthHeaders(cfg.auth));

        let lastError;

        for (let attempt = 1; attempt <= retries + 1; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);

            try {
                this.log(
                    `Fetching signing credentials from ${url} (attempt ${attempt}/${retries + 1})...`,
                    true,
                    'info'
                );

                const res = await fetch(url, {
                    method: 'POST',
                    headers,
                    signal: controller.signal,
                    body: JSON.stringify(cfg.releaseBody || {}),
                });

                clearTimeout(timer);

                if (!res.ok) {
                    const text = await res.text().catch(() => '');
                    throw new Error(
                        `Signing API returned ${res.status} ${res.statusText}` +
                        (text ? ` (${text.slice(0, 200)})` : '')
                    );
                }

                const data = await res.json();

                const failed =
                    data.success === false ||
                    data.status === 'error' ||
                    data.status === 'failed';

                if (failed) {
                    const msg = data.message || data.error || 'unknown error';
                    throw new Error(`Signing API reported failure: ${msg}`);
                }

                const creds = data.credentials || data;

                if (!creds.keystorePassword) {
                    throw new Error(
                        'Signing API response is missing "keystorePassword"'
                    );
                }

                this._signingCredentials = {
                    storePassword: creds.keystorePassword,
                    keyPassword: creds.keyPassword || creds.keystorePassword,
                    keyAlias: creds.keyAlias || null,
                    packageName: creds.packageName || null,
                    keystoreBase64: creds.keystoreBase64 || null,
                };

                this.log('Signing credentials fetched', false, 'success');
                return this._signingCredentials;

            } catch (error) {
                clearTimeout(timer);
                lastError = error.name === 'AbortError'
                    ? new Error(`Signing API timed out after ${timeout}ms`)
                    : error;

                if (attempt <= retries) {
                    const backoff = 500 * attempt;
                    this.log(`  Attempt ${attempt} failed: ${lastError.message}`, true, 'warn');
                    this.log(`  Retrying in ${backoff}ms...`, true, 'warn');
                    await new Promise(r => setTimeout(r, backoff));
                }
            }
        }

        throw new Error(
            `Failed to fetch signing credentials after ${retries + 1} attempts: ${lastError.message}\n` +
            `   • Base URL: ${cfg.apiUrl}\n` +
            `   • Set ${ANDROID_ENV.keystorePassword} env var to skip the API`
        );
    }

    /**
     * Priority: env var - signing API - literal config. Returns null if none.
     */
    async resolveSigningCredentials(overrides = {}) {
        const cfg = await this.getAndroidConfig();

        if (process.env[ANDROID_ENV.keystorePassword]) {
            return {
                storePassword: process.env[ANDROID_ENV.keystorePassword],
                keyPassword: process.env[ANDROID_ENV.keyPassword]
                          || process.env[ANDROID_ENV.keystorePassword],
                keyAlias: overrides.keyAlias
                       || process.env[ANDROID_ENV.keyAlias]
                       || cfg.keyAlias,
                packageName: null,
                keystoreBase64: null,
                source: 'env',
            };
        }

        const fromApi = await this.fetchSigningCredentials();
        if (fromApi) {
            return {
                ...fromApi,
                keyAlias: overrides.keyAlias || fromApi.keyAlias || cfg.keyAlias,
                source: 'api',
            };
        }

        if (cfg.keystorePassword) {
            return {
                storePassword: cfg.keystorePassword,
                keyPassword: cfg.keyPassword || cfg.keystorePassword,
                keyAlias: overrides.keyAlias || cfg.keyAlias,
                packageName: null,
                keystoreBase64: null,
                source: 'config',
            };
        }

        return null;
    }

    /**
     * Write a base64-encoded keystore to a temp file. Returns { path, cleanupDir }.
     */
    async materializeKeystore(base64) {
        if (!base64) return null;

        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xfix-ks-'));
        const ksPath = path.join(tmpDir, 'release.jks');
        await fs.writeFile(ksPath, Buffer.from(base64, 'base64'));

        this.log('Materialised API-provided keystore to temp file', true, 'info');

        return { path: ksPath, cleanupDir: tmpDir };
    }

    /**
     * Phase 1 of provisioning — ask the server what DN / alias / package
     * name to use for a new keystore for this application.
     *
     * POST {base}/api/v1/android-signing/provision/prepare
     */
    async prepareSigningProvision({ appId, apiUrl }) {
        const cfg = await this.getAndroidConfig();
        const base = (apiUrl || cfg.apiUrl || '').replace(/\/+$/, '');

        if (!base) {
            throw new Error(
                'No android signing API URL configured.\n' +
                `   • Set android.apiUrl in .xfixrc.json (default: ${DEFAULT_ANDROID_API_URL})\n` +
                '   • Or pass --api-url <url>'
            );
        }

        const url = joinUrl(base, ANDROID_SIGNING_PATHS.provisionPrepare);

        const headers = {
            'Content-Type': HTTP_DEFAULTS.contentType,
            'Accept': HTTP_DEFAULTS.accept,
            'User-Agent': USER_AGENTS.provisioning,
        };
        Object.assign(headers, this._resolveAuthHeaders(cfg.auth));
        headers[ANDROID_HEADERS.appId] = appId;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), cfg.timeout);

        let res;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers,
                signal: controller.signal,
                body: JSON.stringify({}),
            });
        } catch (error) {
            clearTimeout(timer);
            if (error.name === 'AbortError') {
                throw new Error(`Provisioning prepare timed out after ${cfg.timeout}ms`);
            }
            throw error;
        }
        clearTimeout(timer);

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(
                `Provisioning prepare failed: ${res.status} ${res.statusText}` +
                (text ? ` (${text.slice(0, 300)})` : '')
            );
        }

        const data = await res.json();

        if (data.success === false || data.status === 'error' || data.status === 'failed') {
            throw new Error(
                `Prepare failed: ${data.message || data.error || 'unknown error'}`
            );
        }

        const p = data.provisioning || data;

        if (!p.dname) {
            throw new Error('Provisioning prepare response is missing "dname"');
        }

        this.log(
            `Prepared provisioning for ${appId} (DN from server)`,
            true,
            'info'
        );

        return {
            dname: p.dname,
            keyAlias: p.keyAlias || ANDROID_DEFAULTS.keyAlias,
            packageName: p.packageName || null,
            suggestedFilename: p.suggestedFilename || null,
            passwordOwner: p.passwordOwner || 'client',
            keystorePassword: p.keystorePassword || null,
        };
    }

    /**
     * Phase 2 of provisioning — upload the generated keystore to the server.
     *
     * POST {base}/api/v1/android-signing/provision/commit
     */
    async commitSigningProvision({
        appId,
        keystoreBase64,
        keystorePassword,
        keyAlias,
        packageName,
        apiUrl,
    }) {
        const cfg = await this.getAndroidConfig();
        const base = (apiUrl || cfg.apiUrl || '').replace(/\/+$/, '');

        if (!base) {
            throw new Error('No android signing API URL configured.');
        }

        const url = joinUrl(base, ANDROID_SIGNING_PATHS.provisionCommit);

        const headers = {
            'Content-Type': HTTP_DEFAULTS.contentType,
            'Accept': HTTP_DEFAULTS.accept,
            'User-Agent': USER_AGENTS.provisioning,
        };
        Object.assign(headers, this._resolveAuthHeaders(cfg.auth));
        headers[ANDROID_HEADERS.appId] = appId;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), cfg.timeout);

        let res;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers,
                signal: controller.signal,
                body: JSON.stringify({
                    keystoreBase64,
                    keystorePassword,
                    keyAlias,
                    packageName: packageName || null,
                }),
            });
        } catch (error) {
            clearTimeout(timer);
            if (error.name === 'AbortError') {
                throw new Error(`Provisioning commit timed out after ${cfg.timeout}ms`);
            }
            throw error;
        }
        clearTimeout(timer);

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(
                `Provisioning commit failed: ${res.status} ${res.statusText}` +
                (text ? ` (${text.slice(0, 300)})` : '')
            );
        }

        const data = await res.json();

        if (data.success === false || data.status === 'error' || data.status === 'failed') {
            throw new Error(
                `Commit failed: ${data.message || data.error || 'unknown error'}`
            );
        }

        this.log(`Keystore registered on server for ${appId}`, false, 'success');

        return {
            appId,
            keystorePath: data.keystorePath || null,
            raw: data,
        };
    }

    /**
     * Generate a new JKS keystore via keytool.
     *
     * Output is captured rather than inherited so keytool's raw stderr
     * (Java stack traces, "Command failed: ..." lines) never leaks to the
     * terminal. Errors are normalised into single-line messages.
     */
    async generateKeystore(opts) {
        const keytool = await this.findTool('keytool');
        if (!keytool) {
            throw new Error('keytool not found. Install a JDK 11+ and ensure keytool is on PATH.');
        }

        if (!opts.storepass) {
            throw new Error('Keystore password is required');
        }

        if (opts.storepass.length < 6) {
            throw new Error(
                'Keystore password must be at least 6 characters (keytool requirement).\n' +
                `   Provided length: ${opts.storepass.length}\n` +
                '   The platform administrator must set a longer password\n' +
                '   on the app row (android_keystore_password) before provisioning.'
            );
        }

        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xfix-ks-'));
        const passFile = path.join(tmpDir, 'pass.txt');
        await fs.writeFile(passFile, opts.storepass + '\n');

        try {
            const args = [
                '-genkeypair',
                '-keystore', opts.path,
                '-alias', opts.alias,
                '-keyalg', opts.keyalg || 'RSA',
                '-keysize', String(opts.keysize || 2048),
                '-validity', String(opts.validity || 10000),
                '-storetype', 'JKS',
                '-storepass:file', passFile,
                '-keypass:file', passFile,
                '-dname', opts.dname || 'CN=Unknown, OU=Unknown, O=Unknown, L=Unknown, ST=Unknown, C=Unknown',
            ];

            try {
                execSync(
                    `"${keytool}" ${args.map(a => `"${a}"`).join(' ')}`,
                    {
                        encoding: 'utf-8',
                        stdio: ['ignore', 'pipe', 'pipe'],
                    }
                );
            } catch (execError) {
                const raw = (execError.stderr || execError.stdout || '').toString();

                const match = raw.match(/keytool error:\s*(.+)/);
                const detail = match ? match[1].trim() : null;

                if (detail && /at least 6 characters/i.test(detail)) {
                    throw new Error(
                        'keytool rejected the password: must be at least 6 characters.\n' +
                        '   The platform administrator must set a longer value\n' +
                        '   on the app row (android_keystore_password).'
                    );
                }

                if (detail && /already exists|already been imported/i.test(detail)) {
                    throw new Error(
                        `Keystore already exists at ${opts.path}\n` +
                        '   Pass --force to overwrite, or delete the file first.'
                    );
                }

                if (detail && /alias.*already exists/i.test(detail)) {
                    throw new Error(
                        `Alias "${opts.alias}" already exists in the keystore.\n` +
                        '   Use a different --alias, or delete the keystore first.'
                    );
                }

                if (detail) {
                    throw new Error(`keytool failed: ${detail}`);
                }

                throw new Error(
                    'keytool failed for an unknown reason.\n' +
                    '   Re-run with --verbose and check the JDK installation.'
                );
            }
        } finally {
            await fs.remove(tmpDir).catch(() => {});
        }
    }

    /**
     * Show keystore info via keytool -list.
     */
    async showKeystoreInfo(opts) {
        const cfg = await this.getAndroidConfig();
        const keystorePath = opts.path || cfg.keystorePath;
        const storepass = opts.storepass || cfg.keystorePassword;

        if (!keystorePath || !await fs.pathExists(keystorePath)) {
            throw new Error(`Keystore not found: ${keystorePath}`);
        }
        if (!storepass) throw new Error('Keystore password required');

        const keytool = await this.findTool('keytool');
        if (!keytool) throw new Error('keytool not found');

        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xfix-ks-'));
        const passFile = path.join(tmpDir, 'pass.txt');
        await fs.writeFile(passFile, storepass + '\n');

        try {
            execSync(
                `"${keytool}" -list -v -keystore "${keystorePath}" -storepass:file "${passFile}"`,
                { stdio: 'inherit' }
            );
        } finally {
            await fs.remove(tmpDir).catch(() => {});
        }
    }

    /**
     * Sign an APK: zipalign + apksigner (v1/v2/v3).
     */
    async signApk(apkPath, options = {}) {
        const cfg = await this.getAndroidConfig();

        const resolved = await this.resolveSigningCredentials({
            keyAlias: options.keyAlias,
        });

        if (!resolved) {
            throw new Error(
                'No signing credentials available.\n' +
                '   Provide one of:\n' +
                `   • ${ANDROID_ENV.keystorePassword} env var\n` +
                '   • android.auth in .xfixrc.json (with a signing API)\n' +
                '   • android.keystorePassword in .xfixrc.json (dev only)'
            );
        }

        let keystorePath = options.keystorePath || cfg.keystorePath;
        let tempKeystore = null;

        if (resolved.keystoreBase64) {
            tempKeystore = await this.materializeKeystore(resolved.keystoreBase64);
            keystorePath = tempKeystore.path;
        }

        const storePassword = resolved.storePassword;
        const keyAlias = resolved.keyAlias || cfg.keyAlias;
        const keyPassword = resolved.keyPassword || storePassword;

        try {
            if (!keystorePath || !await fs.pathExists(keystorePath)) {
                const hint = resolved.source === 'api'
                    ? '   • The API returned keystoreBase64: null (server has no .jks)\n' +
                      '   • AND no local keystore exists at the configured path\n' +
                      '   • For local dev: place the .jks at the path above\n' +
                      '   • For CI: fix the server so it returns keystoreBase64'
                    : '   • Set android.keystorePath or ANDROID_KEYSTORE_PATH';

                throw new Error(`Keystore not found: ${keystorePath}\n${hint}`);
            }

            const zipalign = await this.findAndroidBuildTool('zipalign');
            const apksigner = await this.findAndroidBuildTool('apksigner');

            if (!zipalign) throw new Error('zipalign not found. Install Android build-tools and set ANDROID_HOME.');
            if (!apksigner) throw new Error('apksigner not found. Install Android build-tools and set ANDROID_HOME.');

            this.log(`  Credentials source: ${resolved.source}`, true, 'info');

            const aligned = apkPath.replace(/\.apk$/i, '') + '-aligned.apk';

            this.log('  zipalign...', true, 'info');
            execSync(`"${zipalign}" -f -p 4 "${apkPath}" "${aligned}"`, { stdio: 'inherit' });

            this.log('  apksigner...', true, 'info');

            const env = { ...process.env };
            env.XFIX_KS_PASS = storePassword;
            env.XFIX_KEY_PASS = keyPassword;

            const args = [
                'sign',
                '--ks', keystorePath,
                '--ks-key-alias', keyAlias,
                '--ks-pass', 'env:XFIX_KS_PASS',
                '--key-pass', 'env:XFIX_KEY_PASS',
                '--v1-signing-enabled', 'true',
                '--v2-signing-enabled', 'true',
                '--v3-signing-enabled', 'true',
                aligned,
            ];

            execSync(`"${apksigner}" ${args.map(a => `"${a}"`).join(' ')}`, {
                stdio: 'inherit',
                env,
            });

            await fs.move(aligned, apkPath, { overwrite: true });
            this.log(`  Signed: ${path.relative(this.ROOT, apkPath)}`, false, 'success');
            return apkPath;

        } finally {
            if (tempKeystore) {
                await fs.remove(tempKeystore.cleanupDir).catch(() => {});
            }
        }
    }

    /**
     * Sign an AAB (jarsigner-style signing).
     */
    async signAab(aabPath, options = {}) {
        const cfg = await this.getAndroidConfig();

        const resolved = await this.resolveSigningCredentials({
            keyAlias: options.keyAlias,
        });

        if (!resolved) {
            throw new Error(
                'No signing credentials available.\n' +
                `   Set ${ANDROID_ENV.keystorePassword} or configure android.auth in .xfixrc.json.`
            );
        }

        let keystorePath = options.keystorePath || cfg.keystorePath;
        let tempKeystore = null;

        if (resolved.keystoreBase64) {
            tempKeystore = await this.materializeKeystore(resolved.keystoreBase64);
            keystorePath = tempKeystore.path;
        }

        const storePassword = resolved.storePassword;
        const keyAlias = resolved.keyAlias || cfg.keyAlias;
        const keyPassword = resolved.keyPassword || storePassword;

        try {
            if (!keystorePath || !await fs.pathExists(keystorePath)) {
                throw new Error(`Keystore not found: ${keystorePath}`);
            }

            const jarsigner = await this.findTool('jarsigner');
            if (!jarsigner) throw new Error('jarsigner not found. Install a JDK 11+.');

            this.log(`  Credentials source: ${resolved.source}`, true, 'info');

            const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xfix-jar-'));
            const storeFile = path.join(tmpDir, 'store.txt');
            const keyFile = path.join(tmpDir, 'key.txt');
            await fs.writeFile(storeFile, storePassword + '\n');
            await fs.writeFile(keyFile, keyPassword + '\n');

            try {
                const args = [
                    '-keystore', keystorePath,
                    '-storepass:file', storeFile,
                    '-keypass:file', keyFile,
                    '-sigalg', 'SHA256withRSA',
                    '-digestalg', 'SHA-256',
                    aabPath,
                    keyAlias,
                ];

                execSync(`"${jarsigner}" ${args.map(a => `"${a}"`).join(' ')}`, {
                    stdio: 'inherit',
                });
            } finally {
                await fs.remove(tmpDir).catch(() => {});
            }

            this.log(`  Signed: ${path.relative(this.ROOT, aabPath)}`, false, 'success');
            return aabPath;

        } finally {
            if (tempKeystore) {
                await fs.remove(tempKeystore.cleanupDir).catch(() => {});
            }
        }
    }

    /**
     * Verify an APK signature via apksigner.
     */
    async verifyApk(apkPath) {
        const apksigner = await this.findAndroidBuildTool('apksigner');
        if (!apksigner) {
            throw new Error('apksigner not found. Install Android build-tools and set ANDROID_HOME.');
        }
        if (!await fs.pathExists(apkPath)) {
            throw new Error(`APK not found: ${apkPath}`);
        }

        this.log(`Verifying: ${path.relative(this.ROOT, apkPath)}`, false, 'info');
        try {
            execSync(`"${apksigner}" verify --verbose --print-certs "${apkPath}"`, {
                stdio: 'inherit',
            });
            this.log('Signature valid', false, 'success');
            return true;
        } catch (e) {
            this.log('Signature INVALID', false, 'error');
            return false;
        }
    }

    /**
     * Low-level Flutter runner.
     */
    async runFlutter(args) {
        const flutter = await this.findTool('flutter');
        if (!flutter) {
            throw new Error(
                'flutter not found on PATH.\n' +
                '   Install: https://docs.flutter.dev/get-started/install'
            );
        }
        const printable = `flutter ${args.join(' ')}`;
        this.log(`$ ${printable}`, false, 'info');

        try {
            execSync(`"${flutter}" ${args.map(a => `"${a}"`).join(' ')}`, {
                stdio: 'inherit',
                cwd: this.ROOT,
                env: process.env,
            });
        } catch (e) {
            throw new Error(`Flutter command failed: ${printable}`);
        }
    }

    /**
     * Locate APK files produced by a Flutter build.
     */
    async findFlutterApks(flavor) {
        const dir = path.join(this.ROOT, 'build', 'app', 'outputs', 'flutter-apk');
        if (!await fs.pathExists(dir)) return [];

        const entries = await fs.readdir(dir);
        const prefix = flavor ? `app-${flavor}-` : 'app-';

        return entries
            .filter(f => f.startsWith(prefix) && f.endsWith('.apk'))
            .map(f => path.join(dir, f));
    }

    /**
     * Locate the AAB produced by a Flutter build.
     */
    async findFlutterAab(flavor) {
        const dir = path.join(this.ROOT, 'build', 'app', 'outputs', 'bundle');
        if (!await fs.pathExists(dir)) return null;

        const entries = await fs.readdir(dir);
        const prefix = flavor ? `${flavor}Release` : 'release';

        const match = entries.find(f =>
            f.toLowerCase() === `${prefix.toLowerCase()}.aab` ||
            (f.startsWith(prefix) && f.endsWith('.aab'))
        );
        return match ? path.join(dir, match) : null;
    }

    /**
     * Build a Flutter APK.
     */
    async buildFlutterApk(opts = {}) {
        const args = ['build', 'apk', '--release'];
        if (opts.target) args.push('--target', opts.target);
        if (opts.flavor) args.push('--flavor', opts.flavor);
        if (opts.splitPerAbi) args.push('--split-per-abi');
        if (opts.verbose) args.push('-v');

        await this.runFlutter(args);
        return this.findFlutterApks(opts.flavor);
    }

    /**
     * Build a Flutter AAB.
     */
    async buildFlutterAab(opts = {}) {
        const args = ['build', 'appbundle', '--release'];
        if (opts.target) args.push('--target', opts.target);
        if (opts.flavor) args.push('--flavor', opts.flavor);
        if (opts.verbose) args.push('-v');

        await this.runFlutter(args);
        return this.findFlutterAab(opts.flavor);
    }

    /**
     * Build a Flutter iOS archive.
     */
    async buildFlutterIos(opts = {}) {
        const args = ['build', 'ipa', '--release'];
        if (opts.target) args.push('--target', opts.target);
        if (opts.flavor) args.push('--flavor', opts.flavor);
        if (opts.codesign === false) args.push('--no-codesign');
        if (opts.verbose) args.push('-v');

        await this.runFlutter(args);
    }

    /**
     * Build a Flutter web bundle.
     */
    async buildFlutterWeb(opts = {}) {
        const args = ['build', 'web', '--release'];
        if (opts.verbose) args.push('-v');
        await this.runFlutter(args);
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
            'node_modules/**/process.env.js',
        ];

        if (!includeDependencies) {
            exclusives.push('vendor', 'node_modules');
        }

        ig.add(exclusives);

        return ig;
    }

    filterFiles(files, ig) {
        const filtered = [];
        const excluded = [];

        files.forEach((changedFile) => {
            let rel;

            if (typeof changedFile === 'string') {
                rel = path.relative(this.ROOT, changedFile);
            } else {
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

        return { filtered, excluded };
    }

    /**
     * Get the last deploy hash for the current distribution.
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
     * Update deploy marker for the current distribution.
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
     * Get deployment marker status.
     */
    async getDeployStatus() {
        const lastHash = await this.getLastDeployHash();
        const currentHash = (await this.git.revparse(['HEAD'])).trim();

        return {
            lastHash,
            currentHash,
            isUpToDate: lastHash === currentHash,
            hasDeployed: lastHash !== null,
        };
    }

    /**
     * List all distribution deploy markers.
     */
    async listDeployMarkers() {
        const files = await fs.readdir(this.ROOT);
        const markers = files
            .filter(f => f.startsWith('.last-deploy-'))
            .map(f => {
                const distName = f.replace('.last-deploy-', '');
                return { file: f, distribution: distName };
            });

        return markers;
    }

    /**
     * Reset deploy marker for current distribution.
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
     * Get updated files with per-distribution tracking.
     */
    async getUpdatedFiles(config, options = {}) {
        const {
            includeUnstaged = false,
            includeUntracked = false,
            stagedOnly = false,
            includeCommitted = true,
        } = options;

        let lastDeploy = await this.getLastDeployHash();

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
                        staged: true,
                    }));

                this.options.total = changes.length;
                this.options.included = changes.length;
                this.options.excluded = 0;

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

            if (includeCommitted && lastDeploy) {
                const diffArgs = stagedOnly ? ['--cached'] : [];
                const diff = await this.git.diff([
                    '--name-status',
                    '--diff-filter=ACMRT',
                    ...diffArgs,
                    `${lastDeploy}..HEAD`,
                ]);

                const committedChanges = this.parseDiffOutput(diff, {
                    committed: true,
                    staged: true,
                });

                allChanges.push(...committedChanges);
            }

            if (includeUnstaged) {
                const unstagedChanges = await this.getUnstagedChanges();
                allChanges.push(...unstagedChanges);
            }

            if (includeUntracked) {
                const untrackedFiles = await this.getUntrackedFiles();
                allChanges.push(...untrackedFiles);
            }

            allChanges = this.deduplicateChanges(allChanges);

            if (allChanges.length === 0 && config.verbose) {
                this.log(`No changes detected for ${this.distributionName}`, true, 'info');
            }

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

    deduplicateChanges(changes) {
        const fileMap = new Map();

        changes.forEach(change => {
            const key = change.file;

            if (!fileMap.has(key)) {
                fileMap.set(key, change);
            } else {
                const existing = fileMap.get(key);
                if (change.staged === false || change.untracked) {
                    fileMap.set(key, change);
                }
            }
        });

        return Array.from(fileMap.values());
    }

    async getUnstagedChanges() {
        const status = await this.git.status();
        const changes = [];

        status.modified.forEach(file => {
            changes.push({
                status: 'M',
                file,
                fullPath: path.join(this.ROOT, file),
                staged: false,
                committed: false,
            });
        });

        status.deleted.forEach(file => {
            changes.push({
                status: 'D',
                file,
                fullPath: path.join(this.ROOT, file),
                staged: false,
                committed: false,
            });
        });

        if (status.renamed) {
            status.renamed.forEach(rename => {
                changes.push({
                    status: 'R',
                    oldFile: rename.from,
                    file: rename.to,
                    fullPath: path.join(this.ROOT, rename.to),
                    staged: false,
                    committed: false,
                });
            });
        }

        return changes;
    }

    async getUntrackedFiles() {
        const untracked = await this.git.raw([
            'ls-files',
            '--others',
            '--exclude-standard',
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
                staged: false,
            }));
    }

    parseDiffOutput(diff, metadata = {}) {
        return diff
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(line => {
                const parts = line.split('\t');
                const status = parts[0];

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
                        ...metadata,
                    };
                }

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
                        ...metadata,
                    };
                }

                if (status?.startsWith('T')) {
                    const file = parts[1];
                    if (!file || typeof file !== 'string') return null;

                    return {
                        status: 'T',
                        file,
                        fullPath: path.join(this.ROOT, file),
                        ...metadata,
                    };
                }

                const file = parts[1];

                if (!file || typeof file !== 'string') return null;

                return {
                    status,
                    file,
                    fullPath: path.join(this.ROOT, file),
                    ...metadata,
                };
            })
            .filter(Boolean);
    }

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
                    'Untracked': 'New/Untracked',
                }[status] || status;
                this.log(`${statusLabel}: ${count} files`);
            });
        }

        this.options.total = changes.length;
        this.options.included = changes.filter(c => c.status !== 'D').length;
        this.options.excluded = changes.filter(c => c.status === 'D').length;
    }

    async getAllFiles(dir = this.ROOT, depth = 0, maxDepth = 50) {
        if (depth > maxDepth) {
            throw new Error(`Maximum directory depth (${maxDepth}) exceeded at: ${dir}`);
        }

        const entries = await fs.readdir(dir, { withFileTypes: true });

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

    async getDeploymentFiles(config, ig) {
        let files;

        const isSecure = this.options.obfuscateJs ||
                        config.obfuscateJs ||
                        this.options.obfuscatePhp ||
                        config.obfuscatePhp;

        if (this.options.fullDeployment) {
            this.log('  Force full deployment requested...', true);
            files = await this.getAllFiles();
        } else if (isSecure) {
            this.log('  Since you are using secure mode, deploying unstaged changes only...', true);

            const options = {
                includeUnstaged: true,
                includeUntracked: this.options.includeUntracked !== false,
                stagedOnly: false,
                includeCommitted: false,
            };

            files = await this.getUpdatedFiles(config, options);

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
            const options = {
                includeUnstaged: this.options.includeUnstaged || false,
                includeUntracked: this.options.includeUntracked || false,
                stagedOnly: this.options.stagedOnly || false,
                includeCommitted: !this.options.includeUnstaged || this.options.stagedOnly,
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

        const { filtered, excluded } = this.filterFiles(files, ig, config);

        let filePaths;
        if (this.options.fullDeployment) {
            filePaths = filtered;
        } else {
            filePaths = filtered.map(change => {
                if (typeof change === 'string') {
                    return change;
                }
                return change.fullPath;
            });
        }

        const stats = {
            total: files.length,
            included: filtered.length,
            excluded: excluded.length || (files.length - filtered.length),
        };

        this.options.total = stats.total;
        this.options.included = stats.included;
        this.options.excluded = stats.excluded;

        this.displayDeploymentSummary(filtered, stats, isSecure);

        if (!stats.included) {
            this.throwNoFilesError(isSecure);
        }

        return { filePaths, stats, isSecure, filtered };
    }

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
                    try {
                        const trackedVendorFiles = await this.git.raw([
                            'ls-files',
                            '--cached',
                            '--others',
                            '--exclude-standard',
                            'vendor/',
                        ]);

                        if (trackedVendorFiles.trim()) {
                            const vendorFiles = trackedVendorFiles
                                .trim()
                                .split('\n')
                                .filter(Boolean)
                                .map(file => ({
                                    status: 'A',
                                    file,
                                    fullPath: path.join(this.ROOT, file),
                                    dependency: true,
                                    committed: true,
                                    staged: true,
                                }));

                            dependencyPaths.push(...vendorFiles);
                            this.log(`  Found ${vendorFiles.length} vendor files (git)`, true);
                        } else {
                            const vendorFiles = await this.getFilesFromDirectory(vendorPath);
                            dependencyPaths.push(...vendorFiles);
                            this.log(`  Found ${vendorFiles.length} vendor files (filesystem)`, true);
                        }
                    } catch (error) {
                        const vendorFiles = await this.getFilesFromDirectory(vendorPath);
                        dependencyPaths.push(...vendorFiles);
                        this.log(`  Found ${vendorFiles.length} vendor files (filesystem)`, true);
                    }
                } else {
                    const vendorFiles = await this.getFilesFromDirectory(vendorPath);
                    dependencyPaths.push(...vendorFiles);
                    this.log(`  Found ${vendorFiles.length} vendor files (filesystem)`, true);
                }
            } else {
                this.log('  vendor/ directory not found', true);
            }

            if (await fs.pathExists(nodeModulesPath)) {
                if (!isSecure) {
                    try {
                        const trackedNodeFiles = await this.git.raw([
                            'ls-files',
                            '--cached',
                            '--others',
                            '--exclude-standard',
                            'node_modules/',
                        ]);

                        if (trackedNodeFiles.trim()) {
                            const nodeFiles = trackedNodeFiles
                                .trim()
                                .split('\n')
                                .filter(Boolean)
                                .map(file => ({
                                    status: 'A',
                                    file,
                                    fullPath: path.join(this.ROOT, file),
                                    dependency: true,
                                    committed: true,
                                    staged: true,
                                }));

                            dependencyPaths.push(...nodeFiles);
                            this.log(`  Found ${nodeFiles.length} node_modules files (git)`, true);
                        } else {
                            const nodeFiles = await this.getFilesFromDirectory(nodeModulesPath);
                            dependencyPaths.push(...nodeFiles);
                            this.log(`  Found ${nodeFiles.length} node_modules files (filesystem)`, true);
                        }
                    } catch (error) {
                        const nodeFiles = await this.getFilesFromDirectory(nodeModulesPath);
                        dependencyPaths.push(...nodeFiles);
                        this.log(`  Found ${nodeFiles.length} node_modules files (filesystem)`, true);
                    }
                } else {
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

    async getFilesFromDirectory(dirPath) {
        const files = [];

        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                const relativePath = path.relative(this.ROOT, fullPath).replace(/\\/g, '/');

                const skipDirs = ['.git', '.svn', 'test', 'tests', 'docs', 'examples', 'node_modules'];
                const skipFiles = ['.gitattributes', '.gitignore', '.npmignore', '.eslintrc', 'process.env.js'];
                const skipExtensions = ['.md', '.markdown', '.txt', '.log'];

                if (entry.isDirectory()) {
                    if (skipDirs.includes(entry.name)) continue;

                    const subFiles = await this.getFilesFromDirectory(fullPath);
                    files.push(...subFiles);
                } else if (entry.isFile()) {
                    if (skipFiles.some(f => entry.name.startsWith(f))) continue;

                    const ext = path.extname(entry.name).toLowerCase();
                    if (skipExtensions.includes(ext) &&
                        entry.name !== 'composer.lock' &&
                        entry.name !== 'package-lock.json') {
                        continue;
                    }

                    files.push({
                        status: 'A',
                        file: relativePath,
                        fullPath,
                        dependency: true,
                        committed: false,
                        staged: false,
                    });
                }
            }
        } catch (error) {
            this.log(`  Cannot read directory ${dirPath}: ${error.message}`, true);
        }

        return files;
    }

    displayDeploymentSummary(filtered, stats, isSecure) {
        if (this.options.fullDeployment) {
            this.log(
                ` Full deployment: ${stats.total} total files, ${stats.included} included, ${stats.excluded} excluded`,
                true,
                'info'
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
            const mode = this.options.stagedOnly
                ? 'staged'
                : this.options.includeUnstaged
                    ? 'committed + unstaged'
                    : 'committed';

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
            const archive = archiver('zip', { zlib: { level: 9 } });

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
                archive.file(file, { name: relative });
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
                'HEAD',
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

                if (config.protocol === 'sftp') {
                    await client.put(localPath, remotePath);
                } else {
                    await client.uploadFrom(localPath, remotePath);
                }

                this.log('Upload complete', false, 'success');

                const staging = await this.triggerDeploymentStaging(config.deployUrl, config);
                if (staging && staging.status === 'error') {
                    throw new Error(staging.message || 'Unknown staging error');
                }

                this.log('Remote deployment staging successful', false, 'info');
                return;
            } catch (error) {
                lastError = error;

                if (attempt < config.maxRetries) {
                    this.log(
                        `  Upload attempt ${attempt} failed, retrying in ${config.retryDelay / 1000}s...`
                    );

                    await new Promise(resolve => setTimeout(resolve, config.retryDelay));
                }
            }
        }

        throw new Error(
            `Upload failed after ${config.maxRetries} attempts: ${lastError.message}`
        );
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

            const agent = new https.Agent({ family: 4, keepAlive: true });

            const res = await fetch(deployUrl, {
                method: 'POST',
                agent,
                signal: controller.signal,
                body: JSON.stringify(payload),
                headers: {
                    'Content-Type': HTTP_DEFAULTS.contentType,
                    'User-Agent': USER_AGENTS.deployment,
                    [DEPLOY_HEADERS.apiKey]: config.apiKey,
                    [DEPLOY_HEADERS.clientId]: config.clientId,
                },
            });

            clearTimeout(timeout);

            if (!res.ok) {
                const errorText = await res.text();
                let errorPayload = null;

                try {
                    errorPayload = JSON.parse(errorText);
                } catch {
                    // not JSON
                }

                const message = errorPayload?.message
                    ? errorPayload.message
                    : errorText || res.statusText;

                const err = new Error(message);
                err.status = res.status;
                err.statusText = res.statusText;
                err.code = errorPayload?.code ?? res.status;
                err.response = errorPayload;

                throw err;
            }

            const responseData = await res.json();
            if (responseData.status === 'error') {
                throw new Error(responseData.message || 'Unknown deployment error');
            }

            return responseData;

        } catch (error) {
            this.log(`Staging error: ${error?.message || '<no message>'}`, true, 'error');

            if (error.name === 'AbortError') {
                throw new Error('Remote deployment staging timed out after 5 minutes', {
                    cause: error,
                });
            }

            if (error?.code <= 499) {
                throw new Error(
                    `Client error during remote deployment staging: ${error?.message || '<no message>'}`,
                    { cause: error }
                );
            }

            if (error?.code >= 500) {
                throw new Error(
                    `Server error during remote deployment staging: ${error?.message || '<no message>'}`,
                    { cause: error }
                );
            }

            throw error;
        }
    }

    async cleanup(zipPath, config) {
        if (config.cleanupLocal && await fs.pathExists(zipPath)) {
            await fs.remove(zipPath);
            this.log('Cleanup complete', false, 'info');
        }
    }

    async cleanupAfterDeployment(success = true) {
        try {
            if (this.options.obfuscateJs || this.config?.obfuscateJs) {
                await this.revert_js_obfuscation();
            }

            if (this.options.obfuscatePhp || this.config?.obfuscatePhp) {
                await this.revert_php_obfuscation();
            }

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
            'vendor.js',
            'init.js',
            'jquery.js',
            'jquery.min.js',
            'jquery-ui.js',
            'jquery-ui.min.js',
            'icons.min.js',
            '**/*.min.js',
            '**/vendor/**',
            '**/node_modules/**',
            '**/ckeditor*/**',
            '**/tinymce*/**',
            '**/datatables*/**',
            '**/chart*/**',
            '**/dist/**',
            '**/build/**',
            '**/bootstrap*/**',
            '**/select2*/**',
            '**/moment*/**',
            '**/fullcalendar*/**',
        ];

        if (this.config?.exclusiveFiles?.length) {
            this.config.exclusiveFiles.forEach(file => {
                if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) {
                    if (!excluded.includes(file)) {
                        excluded.push(file);
                        this.log(`Excluding JS from obfuscation: ${file}`, true);
                    }
                } else {
                    this.log(`Non-JS file in exclusiveFiles: ${file} (handled elsewhere)`, true);
                }
            });
        }

        return excluded;
    }

    get_obfuscator_config(config) {
        const domainLock = config.domainLock || [
            'http://localhost',
            'http://127.0.0.1',
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
            domainLock,
            domainLockRedirectUrl,
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
            unicodeEscapeSequence: false,
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

        await fs.ensureDir(destPath);

        if (config.preserveOriginal) {
            const preserveDir = config.preserveOriginal;

            if (fs.existsSync(srcPath)) {
                await this.copy_folder_recursive(srcPath, preserveDir);
                this.log(`Original files preserved in: ${preserveDir}`, false, 'backup');
            }
        }

        const exclude_files = this.get_excluded_js_files();
        const obfuscator_config = this.get_obfuscator_config(config);

        const files = glob.sync(`${srcPath}/**/*.js`, { nodir: true });

        for (const file of files) {
            try {
                const relativePath = path.relative(srcPath, file);

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

                const stat = await fs.stat(file);

                if (
                    stat.size > 1024 * 1024 ||
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

                const code = await fs.readFile(file, 'utf8');

                const obfuscated = JavaScriptObfuscator
                    .obfuscate(code, obfuscator_config)
                    .getObfuscatedCode();

                const destFile = path.join(destPath, relativePath);

                await fs.ensureDir(path.dirname(destFile));
                await fs.writeFile(destFile, obfuscated);

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

        const localCandidates = process.platform === 'win32'
            ? [
                path.join(this.ROOT, 'yakpro-po.bat'),
                path.join(this.ROOT, 'yakpro-po.cmd'),
                path.join(this.ROOT, 'yakpro-po'),
                path.join(this.ROOT, 'vendor', 'bin', 'yakpro-po.bat'),
                path.join(this.ROOT, 'vendor', 'bin', 'yakpro-po.cmd'),
                path.join(this.ROOT, 'node_modules', '.bin', 'yakpro-po.cmd'),
                path.join(this.ROOT, 'node_modules', '.bin', 'yakpro-po.bat'),
            ]
            : [
                path.join(this.ROOT, 'yakpro-po'),
                path.join(this.ROOT, 'vendor', 'bin', 'yakpro-po'),
                path.join(this.ROOT, 'node_modules', '.bin', 'yakpro-po'),
            ];

        let yakproPath = null;
        let yakproSource = null;

        for (const candidate of localCandidates) {
            if (await fs.pathExists(candidate)) {
                yakproPath = candidate;
                yakproSource = 'project-local';
                break;
            }
        }

        if (!yakproPath) {
            try {
                const command = process.platform === 'win32'
                    ? 'where.exe yakpro-po'
                    : 'which yakpro-po';

                const found = execSync(command, { encoding: 'utf-8' })
                    .split(/\r?\n/)
                    .map(line => line.trim())
                    .filter(Boolean);

                if (found.length === 0) throw new Error('not found');

                yakproPath = found[0];
                yakproSource = 'global';
            } catch (error) {
                throw new Error(
                    'yakpro-po not found.\n' +
                    '  Expected at vendor/bin/yakpro-po(.bat) or on PATH.\n' +
                    '  Install with: composer require --dev eddiekidiw/yakpro-po'
                );
            }
        }

        if (yakproSource === 'project-local') {
            this.log(`Using (project-local): ${path.relative(this.ROOT, yakproPath)}`, false, 'info');
        } else {
            this.log(`Using (global): ${yakproPath}`, false, 'warn');
            this.log(
                '  Tip: install yakpro-po into this project for reproducible builds:\n' +
                '       composer require --dev eddiekidiw/yakpro-po',
                false,
                'warn'
            );
        }

        const cnf = path.join(this.ROOT, 'yakpro-po.cnf');

        if (!await fs.pathExists(cnf)) {
            throw new Error(
                `yakpro-po.cnf not found at ${cnf}. ` +
                'Place the config in the project root or remove PHP obfuscation.'
            );
        }

        const cnfHead = (await fs.readFile(cnf, 'utf-8'))
            .split(/\r?\n/)
            .slice(0, 2);

        if (cnfHead[1]?.trim() !== '// YAK Pro - Php Obfuscator: Config File') {
            throw new Error(
                `Invalid yakpro-po config: ${cnf}\n` +
                '  Line 2 must be exactly: // YAK Pro - Php Obfuscator: Config File\n' +
                `  Found: ${JSON.stringify(cnfHead[1])}\n` +
                '  Without this marker, yakpro silently ignores the file ' +
                'and uses its packaged default (which scrambles class names).'
            );
        }

        this.log(`Config: ${path.relative(this.ROOT, cnf)}`, true);

        const includeDeps = this.options.includeDependencies || false;
        const ig = this.loadIgnore(includeDeps);

        if (this.config?.exclusiveFiles?.length) {
            this.config.exclusiveFiles.forEach(file => {
                ig.add(file);
                this.log(`Excluding from obfuscation: ${file}`, true);
            });
        }

        let phpFiles = [];
        try {
            phpFiles = await this.scan_php_files_with_ignore(ig);
        } catch (error) {
            throw new Error(`PHP file scan failed: ${error.message}`);
        }

        if (phpFiles.length === 0) {
            this.log('No PHP files found to obfuscate', false, 'info');
            return;
        }

        this.log(`Found ${phpFiles.length} PHP files to obfuscate`, false, 'info');

        let processed = 0;
        let failed = 0;
        const total = phpFiles.length;
        const startTime = Date.now();
        const failedFiles = [];

        const obfuscatedRoot = path.join(this.ROOT, 'obfuscated');

        if (await fs.pathExists(obfuscatedRoot)) {
            await fs.remove(obfuscatedRoot);
        }

        for (let index = 0; index < phpFiles.length; index++) {
            const file = phpFiles[index];
            const sourcePath = path.join(this.ROOT, file);
            const outputFile = path.join(obfuscatedRoot, file);
            const outputDir = path.dirname(outputFile);

            try {
                await fs.ensureDir(outputDir);

                const percent = Math.round(((index + 1) / total) * 100);
                const displayFile = file.length > 40
                    ? '...' + file.substring(file.length - 37)
                    : file;

                process.stdout.write(
                    `\r   [${index + 1}/${total}] ${percent}% - ${displayFile.padEnd(40)}`
                );

                execSync(
                    `"${yakproPath}" "${sourcePath}" -o "${outputFile}" --config-file "${cnf}"`,
                    { stdio: 'pipe', timeout: 60000 }
                );

                if (!await fs.pathExists(outputFile)) {
                    throw new Error(
                        `yakpro exited successfully but produced no output at ${outputFile}`
                    );
                }

                processed++;

            } catch (error) {
                failed++;
                failedFiles.push({ file, error: error.message });

                if (failed <= 5) {
                    this.log(`Failed: ${file}`, false, 'error');
                    this.log(`  ${error.message.split('\n')[0]}`, false, 'error');
                }
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        process.stdout.write('\r' + ' '.repeat(80) + '\r');

        this.log(' ', false, 'space');
        this.log(`PHP obfuscation completed in ${duration}s`, false, 'info');
        this.log(
            `Successfully processed: ${processed}/${total} files`,
            false,
            processed === total ? 'success' : 'warn'
        );

        if (failed > 0) {
            this.log(`Failed: ${failed} files`, false, 'error');
        }

        if (processed === 0) {
            throw new Error(
                'PHP obfuscation produced no output. Aborting before the ' +
                'archive is built — check the first errors above.'
            );
        }

        if (failed > 0) {
            throw new Error(
                `PHP obfuscation failed for ${failed}/${total} files. ` +
                'Aborting to avoid shipping partially-obfuscated code.'
            );
        }

        this.log('\nReplacing original PHP files with obfuscated versions...', false, 'info');

        await this.replace_php_files(phpFiles, failedFiles);

        this.log('PHP files replaced successfully', false, 'info');
        this.log(' ', false, 'space');
    }

    async replace_php_files(phpFiles, failedFiles) {
        const failedFileNames = new Set(failedFiles.map(f => f.file));
        const backupDir = path.join(this.ROOT, 'original_php_backup');

        this.log(`Creating backup in: ${path.relative(this.ROOT, backupDir)}`, false, 'backup');

        let replaced = 0;
        let backedUp = 0;

        for (const file of phpFiles) {
            if (failedFileNames.has(file)) continue;

            const originalPath = path.join(this.ROOT, file);
            const obfuscatedPath = path.join(this.ROOT, 'obfuscated', file);
            const backupPath = path.join(backupDir, file);

            try {
                if (!fs.existsSync(obfuscatedPath)) {
                    this.log(`Obfuscated file not found: ${file}`, true);
                    continue;
                }

                await fs.ensureDir(path.dirname(backupPath));

                await fs.copyFile(originalPath, backupPath);
                backedUp++;

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

        if (replaced > 0) {
            try {
                await fs.remove(path.join(this.ROOT, 'obfuscated'));
                this.log('   Cleaned up obfuscated/ directory', false, 'info');
            } catch (error) {
                this.log('   Could not clean up obfuscated/ directory', true);
            }
        }
    }

    async scan_php_files_with_ignore(ig) {
        const phpFiles = [];

        const scan = async (dir, relativePath = '') => {
            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    const relPath = relativePath
                        ? path.join(relativePath, entry.name)
                        : entry.name;

                    const normalizedPath = relPath.replace(/\\/g, '/');

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

    async revert_php_obfuscation() {
        const backupDir = path.join(this.ROOT, 'original_php_backup');

        if (!fs.existsSync(backupDir)) {
            this.log('No PHP backup found. Nothing to revert.', true);
            return;
        }

        this.log('\nReverting PHP files to original versions...', false, 'info');

        const backupFiles = await this.count_files_recursive(backupDir);
        this.log(`Found ${backupFiles} backed up PHP files`);

        await this.copy_folder_recursive(backupDir, this.ROOT);

        this.log(`Reverted ${backupFiles} PHP files`);

        try {
            await fs.remove(backupDir);
            this.log('Cleaned up backup directory', false, 'info');
        } catch (error) {
            this.log(`Could not clean up backup directory: ${error.message}`, true);
        }
    }

    async revert_js_obfuscation() {
        const config = await this.loadConfig();
        const jsSrc = this.options.jsSrcPath || config.jsSrcPath || 'public/js';
        const jsDest = this.options.jsDestPath || config.jsDestPath || 'public/orig';
        const preserveDir = config.preserveOriginal || 'public/original_js_asset_folder';

        if (!fs.existsSync(jsDest)) {
            this.log('No obfuscated JavaScript found. Nothing to revert.', true);
            return;
        }

        this.log('\nReverting JavaScript files to original versions...', false, 'info');

        if (fs.existsSync(preserveDir)) {
            this.log(`Restoring from backup: ${preserveDir}`);

            if (fs.existsSync(jsSrc)) {
                await fs.remove(jsSrc);
            }

            await fs.ensureDir(jsSrc);
            await this.copy_folder_recursive(preserveDir, jsSrc);

            await fs.remove(preserveDir);
            this.log('   Cleaned up backup directory', false, 'info');
        } else {
            if (fs.existsSync(jsDest)) {
                this.log('   Swapping directories back...', false, 'info');
                await this.rename_directories(jsDest, jsSrc);
            }
        }

        this.log('JavaScript files reverted successfully', false, 'info');
    }

    async count_files_recursive(dir) {
        let count = 0;

        const scan = async (currentDir) => {
            const entries = await fs.readdir(currentDir, { withFileTypes: true });

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
            await fs.move(srcPath, tempPath, { overwrite: true });
            await fs.move(destPath, srcPath, { overwrite: true });
            await fs.move(tempPath, destPath, { overwrite: true });

            this.log('Directories swapped successfully', false, 'info');
        } catch (error) {
            this.log(`Directory swap failed: ${error.message}`, true, 'error');

            try {
                if (fs.existsSync(tempPath)) {
                    await fs.move(tempPath, srcPath, { overwrite: true });
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

            const templateContent = await this.templatesReader('controllers/template.php', {
                controller_name,
            });

            await fs.writeFile(controller_file_path, templateContent);
            this.log(`Controller '${controller_name}' generated`);
            generated++;
        }

        this.log(`\n   Summary: ${generated} created, ${existing} already existed`);
        return { generated, existing };
    }

    /**
     * UTILITY METHODS
     */
    async copy_folder_recursive(source, target) {
        if (!fs.existsSync(target)) {
            fs.mkdirSync(target, { recursive: true });
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

    async deploy() {
        let deployedOk = false;
        const start_time = Date.now();
        const config = await this.loadConfig();

        try {
            this.log('Starting XFIX deployment...', false, 'deploy');

            this.validateConfig(config);

            const framework = config?.framework || 'selfphp';
            if (framework === 'selfphp') {
                this.createService({
                    name: 'MigrationRunner',
                    type: 'migration',
                    verbose: this.options.verbose || false,
                });
            }

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

            await this.validateBranch(config?.branch || 'main');

            this.log('Scanning project files...', false, 'scan');
            const includeDeps = this.options.includeDependencies || false;
            const ig = this.loadIgnore(includeDeps);

            const { filePaths, stats, isSecure } = await this.getDeploymentFiles(config, ig);

            if (!stats.included) return;

            const zip_path = path.join(this.ROOT, 'deploy.zip');
            this.log('Creating archive...', false, 'archive');
            await this.createArchive(zip_path, filePaths, config);

            this.log('Connecting to server...', false, 'connect');

            let client;

            try {
                if (config.protocol === 'sftp') {
                    client = new SftpClient();

                    const accessOptions = {
                        host: config.host,
                        port: config.port || 22,
                        username: config.username,
                        password: config.password,
                        readyTimeout: config.readyTimeout || 30000,
                        retries: config.maxRetries || 3,
                        retry_factor: config.retryFactor || 2,
                        retry_minTimeout: config.retryDelay || 2000,
                    };

                    if (config.verbose) {
                        accessOptions.debug = message => {
                            console.log(`[SFTP] ${message}`);
                        };
                    }

                    await client.connect(accessOptions);

                    this.log('Connected to server', false, 'success');

                    if (config.verbose) {
                        client.trackProgress(info => {
                            this.log(
                                `  ${info.name || 'Transfer'}: ${(info.bytes / 1024).toFixed(1)}KB`,
                                true,
                                'upload'
                            );
                        });
                    }
                } else {
                    const accessOptions = {
                        host: config.host,
                        user: config.username,
                        password: config.password,
                        secure: config.secure,
                        secureOptions: config.secure
                            ? { rejectUnauthorized: config.rejectUnauthorized }
                            : undefined,
                    };

                    if (config.port) {
                        accessOptions.port = config.port;
                    }

                    if (config.secure && config.rejectUnauthorized !== undefined) {
                        accessOptions.secureOptions = {
                            rejectUnauthorized: config.rejectUnauthorized,
                        };
                    }

                    client = new ftp.Client(config.ftpTimeout);

                    if (config.verbose) {
                        client.ftp.verbose = true;
                    }

                    await client.access(accessOptions);

                    this.log('Connected to server', false, 'success');

                    if (config.verbose) {
                        client.trackProgress(info => {
                            this.log(
                                `  Uploaded: ${(info.bytes / 1024).toFixed(1)}KB`,
                                true,
                                'upload'
                            );
                        });
                    }
                }

                const remote_file_path = path.posix.join(
                    config.remotePath,
                    'deploy.zip'
                );

                await this.uploadWithRetry(client, zip_path, remote_file_path, config);
                deployedOk = true;
            } finally {
                if (client) {
                    if (config.protocol === 'sftp') {
                        await client.end();
                        this.log('SFTP connection closed', false, 'info');
                    } else {
                        client.close();
                        this.log('FTP connection closed', false, 'info');
                    }
                }
            }

            if (deployedOk) {
                await this.updateDeployMarker();
            }

        } catch (error) {
            const zip_path = path.join(this.ROOT, 'deploy.zip');
            await this.cleanup(zip_path, config);
            throw error;
        } finally {
            await this.cleanupAfterDeployment(true);
        }
    }

    async obfuscateOnly() {
        const start_time = Date.now();
        const config = await this.loadConfig();

        try {
            this.log('Starting obfuscation process...\n', false, 'info');

            if (this.options.obfuscateJs || config.obfuscateJs) {
                const js_src = this.options.jsSrcPath || config.jsSrcPath || 'public/js';
                const js_dest = this.options.jsDestPath || config.jsDestPath || 'public/orig';

                if (!fs.existsSync(js_src)) {
                    this.log(`JavaScript source directory not found: ${js_src}`, true, 'error');
                    throw new Error(`JavaScript source directory not found: ${js_src}`);
                }

                await this.obfuscateJavaScript(js_src, js_dest, config);
                await this.rename_directories(js_src, js_dest);
            }

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
    async initDatabase() {
        if (this.db) return this.db;

        const config = await this.loadConfig();

        this.dbConfig = {
            host: config.databaseHost,
            user: config.databaseUser,
            password: config.databasePassword,
            database: config.databaseName,
            port: config.databasePort,
            waitForConnections: config.waitDatabaseForConnections,
            connectionLimit: config.databaseConnectionLimit,
            queueLimit: config.databaseQueueLimit,
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

    async createMigration(options) {
        const { name, table, template = 'create', lang = 'js', verbose } = options;

        const now = new Date();
        const timestamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);

        const extension = lang === 'php' ? '.php' : '.mjs';

        const filename = `${timestamp}_${name}${extension}`;
        const migrationsDir = path.join(this.ROOT, 'public/storage/database', 'migrations');

        await fs.ensureDir(migrationsDir);

        const filepath = path.join(migrationsDir, filename);

        let templateContent = await this.getMigrationTemplate(template, name, table, lang);

        if (lang === 'php') {
            templateContent = templateContent.replace(/`/g, '');
        }

        await fs.writeFile(filepath, templateContent);

        if (verbose) {
            this.log(`Created ${lang.toUpperCase()} migration: ${filename}`);
        } else {
            this.log(`Created: ${filename} (${lang.toUpperCase()})`);
        }

        if (lang === 'php') {
            await this.ensureMigrationRunnerExists();
        }

        return filepath;
    }

    async getMigrationTemplate(type, name, table, lang = 'js') {
        const timestamp = new Date().toISOString();
        const tableName = table || name.replace(/_table$/, '');

        let templatePath;

        switch (type) {
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

        const className = this.generateClassName(name);

        const templateContent = await this.templatesReader(templatePath, {
            name,
            tableName,
            timestamp,
            className,
        });

        return templateContent;
    }

    generateClassName(name) {
        const nameWithoutTimestamp = name.replace(/^\d+_/, '');

        return nameWithoutTimestamp
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('');
    }

    async templatesReader(templatePath, variables = {}) {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const partialsDir = path.join(__dirname, 'partials');
        const fullPath = path.join(partialsDir, templatePath);

        if (!await fs.pathExists(fullPath)) {
            throw new Error(`Template file not found: ${fullPath}`);
        }

        let templateContent = await fs.readFile(fullPath, 'utf-8');

        for (const [key, value] of Object.entries(variables)) {
            const placeholder = `{{${key}}}`;
            templateContent = templateContent.split(placeholder).join(value);
        }

        const templatePathExt = templatePath.split('.').pop();

        if (templatePathExt.trim() === 'php') {
            templateContent = templateContent.replace(/`/g, '');
            templateContent = templateContent.replace(/}(\s*);/g, '}$1');
            templateContent = templateContent.replace(/^\s*;\s*$/gm, '');
        }

        return templateContent;
    }

    async runMigrations(options = {}) {
        const { step, dryRun = false, verbose = false } = options;

        await this.initDatabase();

        try {
            const migrationsDir = path.join(this.ROOT, 'public/storage/database', 'migrations');

            if (!await fs.pathExists(migrationsDir)) {
                this.log('No migrations directory found. Creating...', false, 'info');
                await fs.ensureDir(migrationsDir);
                return;
            }

            let migrationFiles = await fs.readdir(migrationsDir);
            migrationFiles = migrationFiles.filter(file => file.endsWith('.mjs')).sort();

            if (migrationFiles.length === 0) {
                this.log('No migration files found', false, 'info');
                return;
            }

            const [executed] = await this.db.execute(
                'SELECT migration FROM migrations ORDER BY batch, id'
            );
            const executedMigrations = new Set(executed.map(row => row.migration));

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

            const [lastBatch] = await this.db.execute(
                'SELECT COALESCE(MAX(batch), 0) as max_batch FROM migrations'
            );
            const currentBatch = (lastBatch[0].max_batch || 0) + 1;

            this.log(
                `\nRunning ${pending.length} migration(s) in batch ${currentBatch}...\n`,
                true,
                'info'
            );

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

                    throw new Error(`Migration failed: ${file} - ${err.message}`);
                }
            }

            this.log(
                `\nMigrations completed: ${successCount} succeeded, ${errorCount} failed`,
                true,
                'info'
            );

        } finally {
            await this.closeDatabase();
        }
    }

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
                    executed_at: row.executed_at,
                });
            });

            this.log('\n' + '-'.repeat(50) + '-' + '-'.repeat(10) + '-' + '-'.repeat(25));
            this.log(' ' + 'Migration'.padEnd(48) + '  ' + 'Status'.padEnd(8) + '  ' + 'Batch/Date'.padEnd(23));
            this.log('-'.repeat(50) + '-' + '-'.repeat(10) + '-' + '-'.repeat(25));

            for (const file of migrationFiles) {
                const status = executedMap.get(file);
                const statusText = status ? 'APPLIED' : 'PENDING';
                const info = status ? `Batch ${status.batch}` : 'Not executed';

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

    async createSeeder(options) {
        const { name, verbose } = options;

        const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
        const filename = `${timestamp}_${name}.mjs`;
        const seedersDir = path.join(this.ROOT, 'public/storage/database', 'seeders');

        await fs.ensureDir(seedersDir);

        const filepath = path.join(seedersDir, filename);

        const templateContent = await this.getSeederTemplate(name, timestamp);

        await fs.writeFile(filepath, templateContent);

        if (verbose) {
            this.log(`Created seeder: ${filename}`);
        } else {
            this.log(`Created: ${filename}`);
        }

        return filepath;
    }

    async getSeederTemplate(name, timestamp) {
        const templateContent = await this.templatesReader('seeders/default.js', {
            name,
            timestamp,
        });

        return templateContent;
    }

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
                    timestamp,
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

    async generateServices(serviceNames, type = 'general') {
        this.log('\nGenerating service classes...\n', false, 'info');

        let created = 0;
        let skipped = 0;
        const results = [];

        for (const name of serviceNames) {
            try {
                const result = await this.createService({
                    name,
                    type,
                    verbose: this.options.verbose || false,
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

        return { created, skipped, results };
    }

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
            className,
            timestamp: new Date().toISOString(),
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

        const templateContent = await this.templatesReader(templatePath, templateVariables);

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
                verbose: false,
            });

            this.log('   MigrationRunner service auto-generated', false, 'info');
        } else {
            this.log('   MigrationRunner already exists', true);
        }
    }

    async closeDatabase() {
        if (this.db) {
            await this.db.end();
            this.log('Database connection closed', true);
        }
    }
}

export default App;