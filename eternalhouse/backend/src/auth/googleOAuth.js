'use strict';
/**
 * Google OAuth 2.0 / OIDC — Authorization Code + PKCE (S256), single-use state + nonce.
 *
 * redirect_uri_mismatch fix:
 *  1. The redirect URI is a single constant (cfg.google.redirectUri) used for BOTH the authorize
 *     request and the token exchange. It is never derived from the incoming Host header.
 *  2. It is validated against APP_ORIGIN at boot (see config/env.js).
 *  3. server.js 308-redirects any non-canonical host (e.g. 127.0.0.1 -> localhost) so the session
 *     cookie that holds state/nonce/PKCE is always on the same host Google redirects back to.
 *  4. The exact URI to whitelist in Google Cloud Console is printed at boot and on /auth/debug (dev).
 */
const express = require('express');
const crypto = require('crypto');
const { Issuer, generators } = require('openid-client');
const cfg = require('../config/env');
const { query, tx } = require('../db/pool');
const cart = require('../services/cart');
const mail = require('../services/mail');

const router = express.Router();

// Static Google metadata: no network call at boot, and no discovery failure can block startup.
const googleIssuer = new Issuer({
  issuer: 'https://accounts.google.com',
  authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  token_endpoint: 'https://oauth2.googleapis.com/token',
  userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
  jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
});

let client = null;
function getClient() {
  if (!cfg.googleConfigured) return null;
  if (!client) {
    client = new googleIssuer.Client({
      client_id: cfg.google.clientId,
      client_secret: cfg.google.clientSecret,
      redirect_uris: [cfg.google.redirectUri],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    });
    client[require('openid-client').custom.clock_tolerance] = 10;
  }
  return client;
}

function safeNext(n) {
  if (typeof n !== 'string' || n.length > 300) return '/';
  if (!n.startsWith('/') || n.startsWith('//') || n.includes('\\') || /[\u0000-\u001f]/.test(n)) return '/';
  return n;
}

async function upsertUser({ sub, email, name, picture, verified }) {
  const role = cfg.adminEmails.includes(email.toLowerCase()) ? 'admin' : null;
  const { rows } = await query(
    `INSERT INTO users (google_sub, email, name, picture, email_verified, role, last_login)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'customer'), now())
     ON CONFLICT (email) DO UPDATE SET
       google_sub = COALESCE(users.google_sub, EXCLUDED.google_sub),
       name = CASE WHEN users.name = '' THEN EXCLUDED.name ELSE users.name END,
       picture = EXCLUDED.picture, email_verified = users.email_verified OR EXCLUDED.email_verified,
       role = CASE WHEN $6 = 'admin' THEN 'admin' ELSE users.role END,
       last_login = now()
     RETURNING id, email, name, role, (xmax = 0) AS created`,
    [sub, email.toLowerCase(), name || '', picture || null, !!verified, role]);
  return rows[0];
}

async function establishSession(req, user) {
  const prevCartId = req.session.cartId;
  await new Promise((res, rej) => req.session.regenerate((e) => (e ? rej(e) : res()))); // anti-fixation
  req.session.uid = user.id;
  await new Promise((res, rej) => req.session.save((e) => (e ? rej(e) : res())));
  if (prevCartId) await cart.merge('a:' + prevCartId, 'u:' + user.id);
}

router.get('/auth/google', (req, res, next) => {
  const c = getClient();
  if (!c) return res.redirect('/login?e=not_configured');
  const state = generators.state();
  const nonce = generators.nonce();
  const verifier = generators.codeVerifier();
  req.session.oauth = { state, nonce, verifier, next: safeNext(req.query.next), t: Date.now() };
  const url = c.authorizationUrl({
    scope: 'openid email profile',
    redirect_uri: cfg.google.redirectUri, // same constant as in callback()
    state, nonce,
    code_challenge: generators.codeChallenge(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  req.session.save((e) => (e ? next(e) : res.redirect(url)));
});

router.get('/auth/google/callback', async (req, res, next) => {
  try {
    const c = getClient();
    const o = req.session.oauth;
    delete req.session.oauth; // single use
    if (!c || !o || Date.now() - o.t > 10 * 60 * 1000) return res.redirect('/login?e=expired');
    if (req.query.error) return res.redirect('/login?e=' + encodeURIComponent(String(req.query.error).slice(0, 40)));
    const params = c.callbackParams(req);
    const tokenSet = await c.callback(cfg.google.redirectUri, params,
      { state: o.state, nonce: o.nonce, code_verifier: o.verifier });
    const claims = tokenSet.claims();
    if (!claims.email || claims.email_verified !== true) return res.redirect('/login?e=unverified');
    const user = await upsertUser({ sub: claims.sub, email: claims.email, name: claims.name, picture: claims.picture, verified: true });
    await establishSession(req, user);
    if (user.created) mail.queue(user.email, 'Welcome to EternalHouse', mail.templates.welcome(user.name), 'registration');
    res.redirect(safeNext(o.next));
  } catch (e) {
    console.error('[oauth] callback failed:', e.message);
    res.redirect('/login?e=failed');
  }
});

// Dev-only login so the whole DFD can be exercised without Google credentials.
router.post('/auth/dev', async (req, res, next) => {
  if (!cfg.devLogin) return res.status(404).end();
  try {
    const email = String(req.body.email || 'dev@eternalhouse.local').toLowerCase().slice(0, 120);
    const user = await upsertUser({ sub: null, email, name: req.body.name || 'Dev User', picture: null, verified: true });
    await establishSession(req, user);
    if (user.created) mail.queue(user.email, 'Welcome to EternalHouse', mail.templates.welcome(user.name), 'registration');
    res.redirect(safeNext(req.body.next));
  } catch (e) { next(e); }
});

router.get('/auth/debug', (req, res) => {
  if (cfg.isProd) return res.status(404).end();
  res.json({
    register_this_exact_redirect_uri: cfg.google.redirectUri,
    also_add_authorized_javascript_origin: cfg.appOrigin,
    open_the_site_at: cfg.appOrigin,
    google_configured: cfg.googleConfigured,
  });
});

router.post('/auth/logout', (req, res, next) => {
  req.session.destroy((e) => {
    if (e) return next(e);
    res.clearCookie('rs.sid');
    res.redirect('/');
  });
});

module.exports = { router, safeNext, establishSession };
