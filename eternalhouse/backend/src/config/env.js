'use strict';
require('dotenv').config();

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const PLACEHOLDER = /^(dev-google-secret|REPLACE_|CHANGE_ME)/i;

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const list = (v) => (v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const cfg = {
  isProd,
  port: int(env.PORT, 3000),
  allowedHosts: list(env.ALLOWED_HOSTS),
  appOrigin: (env.APP_ORIGIN || `http://localhost:${int(env.PORT, 3000)}`).replace(/\/+$/, ''),
  db: {
    url: env.DATABASE_URL,
    poolMax: int(env.DB_POOL_MAX, 8),
    acquireTimeoutMs: int(env.DB_ACQUIRE_TIMEOUT_MS, 5000),
    statementTimeoutMs: int(env.DB_STATEMENT_TIMEOUT_MS, 3000),
  },
  valkey: {
    url: env.VALKEY_URL || env.REDIS_URL,
    connectTimeoutMs: int(env.VALKEY_CONNECT_TIMEOUT_MS, 500),
    ttlSeconds: 3600,
  },
  sessionSecret: env.SESSION_SECRET || '',
  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: env.GOOGLE_REDIRECT_URI || '',
  },
  adminEmails: list(env.ADMIN_EMAILS),
  devLogin: env.DEV_LOGIN === '1' && !isProd,
  usdInr: Number(env.USD_INR) || 84,
  cashfree: {
    appId: env.CASHFREE_APP_ID || '', secret: env.CASHFREE_SECRET_KEY || '',
    env: env.CASHFREE_ENV === 'production' && isProd ? 'production' : 'sandbox', // sandbox unless explicitly production
    apiBase: env.CASHFREE_API_BASE || '', version: '2023-08-01',
  },
  mail: {
    provider: (env.MAIL_PROVIDER || 'auto').toLowerCase(),
    from: env.MAIL_FROM || '',
    refreshToken: env.GMAIL_REFRESH_TOKEN || '',
    brevoKey: env.BREVO_API_KEY || '',
    smtp: { host: env.SMTP_HOST || 'smtp-relay.brevo.com', port: int(env.SMTP_PORT, 587), user: env.SMTP_USER || '', pass: env.SMTP_KEY || '' },
    brevoBase: (env.BREVO_API_BASE || 'https://api.brevo.com').replace(/\/+$/, ''),
  },
};

cfg.googleConfigured =
  !!cfg.google.clientId && !!cfg.google.clientSecret && !PLACEHOLDER.test(cfg.google.clientSecret) && cfg.google.clientSecret.length > 8;
cfg.cashfree.apiBase = cfg.cashfree.apiBase || (cfg.cashfree.env === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com');
cfg.cashfreeConfigured = !!(cfg.cashfree.appId && cfg.cashfree.secret);
cfg.paymentMode = cfg.cashfreeConfigured ? 'cashfree' : 'mock';

// ---- Canonical-origin / redirect-URI consistency (root cause of redirect_uri_mismatch) ----
const problems = [];
if (!['auto', 'brevo'].includes(cfg.mail.provider)) problems.push('MAIL_PROVIDER must be auto or brevo');
let origin;
try { origin = new URL(cfg.appOrigin); } catch { problems.push('APP_ORIGIN is not a valid URL'); }
if (origin) {
  cfg.canonicalHost = origin.host;
  if (!cfg.allowedHosts.includes(origin.host.toLowerCase())) cfg.allowedHosts.push(origin.host.toLowerCase());
  // Redirect URI defaults to APP_ORIGIN + callback path so the two can never drift apart.
  if (!cfg.google.redirectUri) cfg.google.redirectUri = `${cfg.appOrigin}/auth/google/callback`;
  let r;
  try { r = new URL(cfg.google.redirectUri); } catch { problems.push('GOOGLE_REDIRECT_URI is not a valid URL'); }
  if (r && r.origin !== origin.origin) {
    problems.push(`GOOGLE_REDIRECT_URI origin (${r.origin}) must equal APP_ORIGIN origin (${origin.origin})`);
  }
  if (r && r.pathname !== '/auth/google/callback') {
    problems.push('GOOGLE_REDIRECT_URI path must be /auth/google/callback');
  }
  if (isProd && origin.protocol !== 'https:') problems.push('APP_ORIGIN must be https in production');
}
if (!cfg.db.url) problems.push('DATABASE_URL is required');

if (isProd) {
  if (cfg.sessionSecret.length < 32) problems.push('SESSION_SECRET must be >= 32 chars');
  if (!cfg.allowedHosts.length) problems.push('ALLOWED_HOSTS is required');
  if (!cfg.valkey.url) problems.push('VALKEY_URL is required');
  if (!cfg.googleConfigured) problems.push('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (real values) are required');
  if (problems.length) {
    console.error('FATAL config errors:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
} else {
  if (!cfg.sessionSecret) cfg.sessionSecret = require('crypto').randomBytes(32).toString('hex');
  problems.forEach((p) => console.warn('[config] WARNING:', p));
}

module.exports = cfg;
