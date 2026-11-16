'use strict';
const path = require('path');
const paths = require('./config/paths');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cfg = require('./config/env');
const { query, DbBusyError } = require('./db/pool');
const valkey = require('./cache/valkey');
const { csp, hostGuard, csrf, cookies } = require('./middleware/security');
const { sessionMw } = require('./middleware/session');
const { router: authRouter } = require('./auth/googleOAuth');
const localAuthRouter = require('./auth/localAuth');
const art = require('./services/art');
const cart = require('./services/cart');

const app = express();
app.disable('x-powered-by');
if (cfg.isProd) app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', paths.views);
app.set('etag', 'strong');

app.use(hostGuard);
app.use(csp());
app.use(compression({ threshold: 512 }));

// ---- cache-busted static assets ----
const pub = paths.pub;
const assetV = (() => {
  const h = crypto.createHash('md5');
  for (const d of ['css', 'js']) for (const f of fs.readdirSync(path.join(pub, d)).sort()) h.update(fs.statSync(path.join(pub, d, f)).mtimeMs + f);
  return h.digest('hex').slice(0, 8);
})();
const longCache = cfg.isProd ? { maxAge: '365d', immutable: true } : { maxAge: 0 };
app.use('/css', express.static(path.join(pub, 'css'), longCache));
app.use('/js', express.static(path.join(pub, 'js'), longCache));
app.use('/media-files', express.static(paths.media, { maxAge: '30d', index: false }));

app.get('/favicon.svg', (req, res) => res.type('image/svg+xml').set('Cache-Control', 'public, max-age=604800').send(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0a0908"/><text x="32" y="43" text-anchor="middle" font-family="Georgia,serif" font-size="34" fill="#c9a45c">R</text></svg>'));
app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));

// ---- generated product / lookbook visuals ----
let productIndex = null;
async function products() {
  if (!productIndex) {
    const { rows } = await query('SELECT id, brand, name, category, subcategory FROM products');
    productIndex = new Map(rows.map((r) => [r.id, r]));
  }
  return productIndex;
}
function sendSvg(res, svg) {
  res.set({ 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
  res.send(svg);
}
app.get('/media/p/:id/:n.svg', async (req, res, next) => {
  try {
    const p = (await products()).get(parseInt(req.params.id, 10));
    const n = parseInt(req.params.n, 10);
    if (!p || ![1, 2, 3, 4, 5].includes(n)) return res.status(404).end();
    sendSvg(res, art.render(p, n));
  } catch (e) { next(e); }
});
app.get('/media/l/:id.svg', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT title, designer, year FROM lookbook WHERE id=$1', [parseInt(req.params.id, 10) || 0]);
    if (!rows[0]) return res.status(404).end();
    sendSvg(res, art.renderLook(rows[0]));
  } catch (e) { next(e); }
});

// ---- health (DB + Valkey) ----
app.get('/api/health', async (req, res) => {
  const out = { db: { ok: false }, valkey: await valkey.ping() };
  try { const t = Date.now(); await query('SELECT 1'); out.db = { ok: true, ms: Date.now() - t }; } catch (e) { out.db = { ok: false, reason: e.message }; }
  res.status(out.db.ok ? 200 : 503).json({ ok: out.db.ok, ...out });
});

// ---- dynamic app ----
app.use(cookies);
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(csrf);
app.use('/auth', rateLimit({ windowMs: 10 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: true, legacyHeaders: false }));
app.use(sessionMw);

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
app.use(async (req, res, next) => {
  try {
    res.locals.v = assetV;
    res.locals.inr = inr;
    res.locals.cfg = { devLogin: cfg.devLogin, googleConfigured: cfg.googleConfigured, paymentMode: cfg.paymentMode, isProd: cfg.isProd,
      redirectUri: cfg.google.redirectUri, cashfree: cfg.cashfreeConfigured };
    res.locals.user = null;
    if (req.session && req.session.uid) {
      const { rows } = await query('SELECT id, email, name, picture, role FROM users WHERE id=$1', [req.session.uid]);
      if (rows[0]) res.locals.user = rows[0]; else delete req.session.uid;
    }
    req.user = res.locals.user;
    if (!/^\/(api|auth|css|js|media)/.test(req.path)) res.locals.cartCount = await cart.count(cart.ownerKey(req));
    next();
  } catch (e) { next(e); }
});

app.use(authRouter);
app.use(localAuthRouter);
app.use('/api', require('./routes/api'));
app.use(require('./routes/pages'));

app.use((req, res) => res.status(404).render('404', { title: 'Not found' }));
app.use((err, req, res, next) => {
  const status = err instanceof DbBusyError ? 503 : err.status || 500;
  if (status >= 500) console.error('[error]', err.message);
  if (res.headersSent) return next(err);
  if (status === 503) res.set('Retry-After', '2');
  if (req.path.startsWith('/api')) return res.status(status).json({ error: status === 503 ? 'Busy, please retry' : 'Something went wrong' });
  res.status(status).render('error', { title: 'Error', status, v: res.locals.v || assetV, csrf: res.locals.csrf || '',
    user: res.locals.user || null, cartCount: res.locals.cartCount || 0,
    message: status === 503 ? 'We are very busy — please retry in a moment.' : 'Something went wrong.' });
});

valkey.init();
const server = app.listen(cfg.port, () => {
  console.log(`EternalHouse listening on ${cfg.appOrigin}  (${cfg.isProd ? 'production' : 'development'})`);
  console.log(`[oauth] Redirect URI to whitelist in Google Cloud Console: ${cfg.google.redirectUri}`);
  console.log(`[oauth] Authorized JavaScript origin: ${cfg.appOrigin}   | Google ${cfg.googleConfigured ? 'configured' : 'NOT configured (placeholder secret)'}${cfg.devLogin ? ' | DEV_LOGIN on' : ''}`);
  console.log(`[pay] mode: ${cfg.paymentMode}`);
});

function shutdown() {
  server.close(async () => { await valkey.close(); require('./db/pool').pool.end().finally(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

module.exports = app;
