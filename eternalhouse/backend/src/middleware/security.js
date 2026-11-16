'use strict';
const crypto = require('crypto');
const helmet = require('helmet');
const cfg = require('../config/env');

function csp() {
  const rz = cfg.cashfreeConfigured;
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", ...(rz ? ['https://sdk.cashfree.com'] : [])],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:', ...(rz ? ['https://*.cashfree.com'] : [])],
        'media-src': ["'self'"],
        'font-src': ["'self'"],
        'connect-src': ["'self'", ...(rz ? ['https://*.cashfree.com'] : [])],
        'frame-src': rz ? ['https://*.cashfree.com'] : ["'none'"],
        'form-action': ["'self'", 'https://accounts.google.com'],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'frame-ancestors': ["'none'"],
        ...(cfg.isProd ? { 'upgrade-insecure-requests': [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
}

// Reject unknown Host headers; send non-canonical hosts (127.0.0.1, www.) to the canonical origin
// so cookies, OAuth state and Google's registered redirect URI always agree.
function hostGuard(req, res, next) {
  const host = (req.headers.host || '').toLowerCase();
  if (!cfg.allowedHosts.includes(host)) return res.status(421).type('text').send('Misdirected request');
  if (host !== cfg.canonicalHost.toLowerCase() && (req.method === 'GET' || req.method === 'HEAD')) {
    return res.redirect(308, cfg.appOrigin + req.originalUrl);
  }
  next();
}

// Double-submit CSRF: httpOnly cookie + token echoed in forms / X-CSRF-Token header + Origin check.
function csrf(req, res, next) {
  let token = req.cookies && req.cookies['rs.csrf'];
  if (!token || !/^[a-f0-9]{48}$/.test(token)) {
    token = crypto.randomBytes(24).toString('hex');
    res.cookie('rs.csrf', token, { httpOnly: true, sameSite: 'lax', secure: cfg.isProd, path: '/' });
  }
  res.locals.csrf = token;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = req.get('x-csrf-token') || (req.body && req.body._csrf) || '';
  const a = Buffer.from(String(sent)); const b = Buffer.from(token);
  const origin = req.get('origin');
  const originOk = !origin || origin === cfg.appOrigin;
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b) || !originOk) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
}

// tiny cookie parser (avoids another dependency)
function cookies(req, res, next) {
  const h = req.headers.cookie; req.cookies = {};
  if (h) h.split(';').forEach((p) => {
    const i = p.indexOf('='); if (i < 0) return;
    try { req.cookies[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (_) { /* skip */ }
  });
  next();
}

module.exports = { csp, hostGuard, csrf, cookies };
