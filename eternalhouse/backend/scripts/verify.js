'use strict';
/**
 * npm run verify — integration checks for PostgreSQL, Valkey/Redis, OAuth redirect_uri, CSP and the DFD flows.
 * Boots its own server on :3111 against the DATABASE_URL / VALKEY_URL in .env.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
process.env.NODE_ENV = 'development';
const cfg = require('../src/config/env');
const { pool, query } = require('../src/db/pool');
const Redis = require('ioredis');

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓', name, extra ? `(${extra})` : ''); } else { fail++; console.log('  ✗', name, extra ? `— ${extra}` : ''); } };
const section = (s) => console.log('\n' + s);

const PORT = 3111;
const ORIGIN = `http://localhost:${PORT}`;

class Client {
  constructor() { this.jar = {}; }
  async req(p, o = {}) {
    const headers = { ...(o.headers || {}) };
    const ck = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (ck) headers.cookie = ck;
    if (o.json) { headers['content-type'] = 'application/json'; headers['x-csrf-token'] = this.jar['rs.csrf'] || ''; }
    if (o.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; }
    const r = await fetch((o.base || ORIGIN) + p, { method: o.method || (o.json || o.form ? 'POST' : 'GET'), redirect: 'manual', headers,
      body: o.json ? JSON.stringify(o.json) : o.form ? new URLSearchParams({ ...o.form, _csrf: this.jar['rs.csrf'] || '' }).toString() : undefined });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach((c) => { const [kv] = c.split(';'); const i = kv.indexOf('='); this.jar[kv.slice(0, i)] = kv.slice(i + 1); });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch (_) { /* html */ }
    return { status: r.status, headers: r.headers, text, json };
  }
  async login(email) {
    await this.req('/login');
    return this.req('/auth/dev', { form: { email, name: email.split('@')[0], next: '/' } });
  }
}

async function main() {
  // ------------------------------------------------------------------ PostgreSQL
  section('PostgreSQL');
  const t0 = Date.now();
  const v = await query('SHOW server_version');
  ok('connects', true, `v${v.rows[0].server_version}, ${Date.now() - t0}ms`);
  const st = await query('SHOW statement_timeout');
  ok('statement_timeout applied', st.rows[0].statement_timeout !== '0', st.rows[0].statement_timeout);
  const counts = await query('SELECT (SELECT count(*) FROM products)::int p, (SELECT count(*) FROM lookbook)::int l, (SELECT count(*) FROM product_media WHERE kind=\'image\')::int m, (SELECT count(*) FROM product_media WHERE kind=\'video\')::int v, (SELECT count(DISTINCT url) FROM product_media WHERE kind=\'video\')::int vu');
  ok('catalog seeded: 918 products (700–900+ added)', counts.rows[0].p === 918, counts.rows[0].p);
  ok('lookbook seeded: 50 looks', counts.rows[0].l === 50, counts.rows[0].l);
  ok('5 photos per product', counts.rows[0].m === counts.rows[0].p * 5, counts.rows[0].m);
  ok('1 distinct film per product', counts.rows[0].v === counts.rows[0].p && counts.rows[0].vu === counts.rows[0].p, counts.rows[0].v);
  ok('pool is bounded', pool.options.max === cfg.db.poolMax, `max=${pool.options.max}`);
  const slow = await query('SELECT pg_sleep(0.05)').then(() => true).catch(() => false);
  ok('simple query under timeout', slow);
  const timedOut = await query('SELECT pg_sleep(' + (cfg.db.statementTimeoutMs / 1000 + 1) + ')').then(() => false).catch((e) => /statement timeout/.test(e.message));
  ok('slow query is cancelled by statement_timeout', timedOut);

  // ------------------------------------------------------------------ Valkey / Redis
  section('Valkey / Redis');
  const rc = new Redis(cfg.valkey.url, { connectTimeout: cfg.valkey.connectTimeoutMs, lazyConnect: true, maxRetriesPerRequest: 1 });
  rc.on('error', () => {});
  try {
    await rc.connect();
    const t1 = Date.now(); const pong = await rc.ping();
    ok('connects + PING', pong === 'PONG', `${Date.now() - t1}ms`);
    await rc.set('rs:verify', '1', 'EX', 5); ok('SET/GET round-trip', (await rc.get('rs:verify')) === '1');
  } catch (e) { ok('connects + PING', false, e.message); }

  // ------------------------------------------------------------------ boot a server with a "configured" Google client
  section('Booting test server');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), APP_ORIGIN: ORIGIN, ALLOWED_HOSTS: `localhost:${PORT},127.0.0.1:${PORT}`,
      GOOGLE_REDIRECT_URI: `${ORIGIN}/auth/google/callback`, GOOGLE_CLIENT_SECRET: 'GOCSPX-verify-secret-abcdef123456', DEV_LOGIN: '1', ADMIN_EMAILS: 'admin@verify.test' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/listening/.test(log); i++) await new Promise((r) => setTimeout(r, 150));
  ok('server started', /listening/.test(log));
  await new Promise((r) => setTimeout(r, 800)); // let Valkey connect

  try {
    // -------------------------------------------------------------- health
    section('Health endpoint (DB + Valkey through the app)');
    const c = new Client();
    const h = await c.req('/api/health');
    ok('GET /api/health 200', h.status === 200, JSON.stringify(h.json));
    ok('app sees Postgres', h.json && h.json.db.ok);
    ok('app sees Valkey', h.json && h.json.valkey.ok);

    // -------------------------------------------------------------- OAuth
    section('Google OAuth — redirect_uri_mismatch fix');
    const g = await c.req('/auth/google?next=/shop');
    const loc = g.headers.get('location') || '';
    const u = new URL(loc || 'http://x');
    ok('redirects to accounts.google.com', u.host === 'accounts.google.com', u.host);
    ok('redirect_uri == configured constant', u.searchParams.get('redirect_uri') === `${ORIGIN}/auth/google/callback`, u.searchParams.get('redirect_uri'));
    ok('PKCE S256', u.searchParams.get('code_challenge_method') === 'S256' && !!u.searchParams.get('code_challenge'));
    ok('state + nonce present', !!u.searchParams.get('state') && !!u.searchParams.get('nonce'));
    ok('client_id sent', u.searchParams.get('client_id') === cfg.google.clientId);
    const alt = await c.req('/auth/google', { base: `http://127.0.0.1:${PORT}` });
    ok('127.0.0.1 is 308-redirected to canonical localhost (cookie/state host stays consistent)', alt.status === 308 && alt.headers.get('location').startsWith(ORIGIN), alt.headers.get('location'));
    const badStatus = await new Promise((res) => { const q = require('http').request({ host: '127.0.0.1', port: PORT, path: '/', headers: { host: 'evil.example' } }, (r) => { r.resume(); res(r.statusCode); }); q.on('error', () => res(0)); q.end(); });
    ok('unknown Host header rejected (421)', badStatus === 421, badStatus);
    const cb = await c.req('/auth/google/callback?code=x&state=forged');
    ok('callback with forged state is rejected', cb.status === 302 && /\/login\?e=/.test(cb.headers.get('location')), cb.headers.get('location'));
    const dbg = await c.req('/auth/debug');
    ok('/auth/debug shows the URI to whitelist', dbg.json && dbg.json.register_this_exact_redirect_uri === `${ORIGIN}/auth/google/callback`);
    const open = await c.req('/auth/google?next=//evil.com');
    ok('open-redirect next is sanitised (stored as /)', open.status === 302);

    // -------------------------------------------------------------- pages + CSP
    section('Pages, CSP, performance headers');
    const pages = ['/', '/shop', '/shop?cat=Footwear&sort=price_asc', '/shop?q=prada', '/lookbook', '/cart', '/login'];
    for (const p of pages) { const r = await c.req(p); ok(`GET ${p} → 200`, r.status === 200, `${(r.text.length / 1024).toFixed(0)} KB`); }
    const home = await c.req('/');
    const csp = home.headers.get('content-security-policy') || '';
    ok("CSP: script-src 'self' only", /script-src 'self'(;|$)/.test(csp));
    ok("CSP: style-src 'self' only (no unsafe-inline)", /style-src 'self'(;|$)/.test(csp));
    ok('CSP: object-src none, frame-ancestors none', /object-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp));
    const allHtml = (await Promise.all(['/', '/shop', '/lookbook', '/cart', '/login'].map((p) => c.req(p)))).map((r) => r.text).join('\n');
    ok('no inline <script>', !/<script(?![^>]*\bsrc=)[^>]*>/i.test(allHtml));
    ok('no inline style="" attributes', !/\sstyle="/.test(allHtml.replace(/<svg[\s\S]*?<\/svg>/g, '')));
    ok('no inline on*= handlers', !/\son[a-z]+="/i.test(allHtml));
    ok('client JS has no innerHTML', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(fs.readFileSync(path.join(require('../src/config/paths').pub, 'js', 'app.js'), 'utf8')));
    ok('gzip enabled', (await fetch(ORIGIN + '/', { headers: { 'accept-encoding': 'gzip' } })).headers.get('content-encoding') === 'gzip');
    const svg = await c.req('/media/p/1/2.svg');
    ok('generated product art served + immutable cache', svg.status === 200 && /immutable/.test(svg.headers.get('cache-control')), `${(svg.text.length / 1024).toFixed(1)} KB`);
    const tt = Date.now(); for (let i = 0; i < 20; i++) await c.req('/shop'); const avg = (Date.now() - tt) / 20;
    ok('/shop renders fast (avg of 20)', avg < 120, `${avg.toFixed(1)} ms`);

    // -------------------------------------------------------------- Valkey product summary cache
    section('Valkey product cache (3 fields, 1h TTL, eviction)');
    const pr = (await query("SELECT id, name, price_inr, stock FROM products WHERE record_id='R004'")).rows[0];
    await rc.del(`rs:prod:${pr.id}`);
    const s1 = await c.req(`/api/products/${pr.id}/summary`);
    ok('summary API returns name/price/stock', s1.json && s1.json.name === pr.name && s1.json.price === pr.price_inr && s1.json.stock === pr.stock);
    const h1 = await rc.hgetall(`rs:prod:${pr.id}`);
    ok('cached hash has exactly 3 fields', Object.keys(h1).sort().join() === 'name,price,stock', Object.keys(h1).join());
    const ttl = await rc.ttl(`rs:prod:${pr.id}`);
    ok('TTL ≤ 3600s', ttl > 0 && ttl <= 3600, `${ttl}s`);
    const s2 = await c.req(`/api/products/${pr.id}/summary`);
    ok('second read served by Valkey', s2.json.cache === 'valkey');

    // -------------------------------------------------------------- DFD flows
    section('DFD flows: 1.0 auth → 2.0 cart → 3.0 checkout → 4.0 email → 5.0 admin');
    const noAuth = await c.req('/api/checkout', { json: { name: 'x' } });
    ok('checkout requires login (401)', noAuth.status === 401);
    const noCsrf = await fetch(`${ORIGIN}/api/cart/add`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"id":1}' });
    ok('POST without CSRF token rejected (403)', noCsrf.status === 403);

    const a = new Client(); await a.req('/');
    const add0 = await a.req('/api/cart/add', { json: { id: pr.id, qty: 2 } });
    ok('2.0 anonymous add-to-cart', add0.json && add0.json.count === 2);
    const email = `buyer${Date.now()}@verify.test`;
    const lg = await a.login(email);
    ok('1.0 login (session regenerated) → 302', lg.status === 302);
    const cartA = await a.req('/api/cart');
    ok('anonymous cart merged into user cart', cartA.json && cartA.json.items.length === 1 && cartA.json.items[0].qty === 2);
    await a.req('/api/cart/add', { json: { id: pr.id, qty: 99 } });
    const capped = await a.req('/api/cart');
    ok('quantity capped at 10', capped.json.items[0].qty === 10, capped.json.items[0].qty);
    await a.req('/api/cart/set', { json: { id: pr.id, qty: 1 } });
    const badCoupon = await a.req('/api/cart/coupon', { json: { code: 'FREEMONEY' } });
    ok('invalid coupon rejected', badCoupon.status === 400);
    await a.req('/api/cart/coupon', { json: { code: 'genz20' } });
    const cp = await a.req('/api/cart');
    const expDisc = Math.round(pr.price_inr * 0.2);
    ok('GENZ20 = 20% computed server-side', cp.json.totals.discount === expDisc && cp.json.totals.total === pr.price_inr - expDisc + cp.json.totals.shipping, `₹${cp.json.totals.total}`);
    ok('shipping charged below ₹999', cp.json.totals.shipping > 0, `₹${cp.json.totals.shipping}`);
    await a.req('/api/cart/set', { json: { id: pr.id, qty: Math.ceil(1500 / pr.price_inr) } });
    const big = await a.req('/api/cart');
    ok('free shipping ≥ ₹999', big.json.totals.shipping === 0, `qty ${Math.ceil(1500 / pr.price_inr)}`);
    await a.req('/api/cart/set', { json: { id: pr.id, qty: 1 } });
    const badShip = await a.req('/api/checkout', { json: { name: 'A', phone: '1', line1: '', city: '', state: '', pin: '12' } });
    ok('checkout validates shipping details', badShip.status === 400);
    const chk = await a.req('/api/checkout', { json: { name: 'Verify Buyer', phone: '9876543210', line1: '1 Test Street', city: 'Guwahati', state: 'Assam', pin: '781001' } });
    ok('3.0 order created (stock reserved)', chk.status === 200 && chk.json.orderNo, chk.json && chk.json.orderNo);
    const afterCreate = (await query('SELECT stock FROM products WHERE id=$1', [pr.id])).rows[0].stock;
    ok('stock decremented in PostgreSQL', afterCreate === pr.stock - 1, `${pr.stock} → ${afterCreate}`);
    const ev = await rc.exists(`rs:prod:${pr.id}`);
    ok('Valkey summary evicted after checkout', ev === 0);
    const pay = await a.req('/api/checkout/mock-pay', { json: { orderId: chk.json.orderId } });
    ok('payment confirmation → paid', pay.status === 200 && pay.json.ok);
    const repay = await a.req('/api/checkout/mock-pay', { json: { orderId: chk.json.orderId } });
    ok('double payment is refused', repay.status === 409);
    const od = await a.req(`/orders/${chk.json.orderNo}`);
    ok('order page renders', od.status === 200 && /Order confirmed/.test(od.text));
    await new Promise((r) => setTimeout(r, 500));
    const mails = (await query('SELECT kind, status FROM email_outbox WHERE to_email=$1 ORDER BY id', [email])).rows;
    ok('4.0 registration email queued', mails.some((m) => m.kind === 'registration'), JSON.stringify(mails));
    ok('4.0 order receipt email queued', mails.some((m) => m.kind === 'order_receipt'));
    const emptied = await a.req('/api/cart');
    ok('cart cleared after payment', emptied.json.items.length === 0);

    // 5.0 admin
    const plain = await a.req('/admin'); ok('non-admin blocked from /admin (403)', plain.status === 403);
    const adm = new Client(); await adm.login('admin@verify.test');
    for (const t of ['reports', 'products', 'orders', 'users', 'emails']) { const r = await adm.req('/admin?tab=' + t); ok(`5.0 admin tab "${t}"`, r.status === 200); }
    const upd = await adm.req(`/api/admin/products/${pr.id}`, { json: { stock: 7 } });
    ok('5.0 admin updates stock', upd.json && upd.json.product.stock === 7);
    const denied = await a.req(`/api/admin/products/${pr.id}`, { json: { stock: 999 } });
    ok('customer cannot call admin API (403)', denied.status === 403);
    const ord = (await query('SELECT id FROM orders WHERE order_no=$1', [chk.json.orderNo])).rows[0];
    const ship = await adm.req(`/api/admin/orders/${ord.id}/status`, { json: { status: 'shipped' } });
    ok('5.0 admin ships order → alert email (4.0)', ship.status === 200);
    await new Promise((r) => setTimeout(r, 400));
    ok('order_alert email queued', (await query("SELECT 1 FROM email_outbox WHERE to_email=$1 AND kind='order_alert'", [email])).rowCount > 0);

    // concurrency: last unit of stock, two buyers at once → exactly one wins
    section('Concurrency: two buyers race for the last unit');
    await query("UPDATE products SET stock=1 WHERE record_id='R011'"); const rid = (await query("SELECT id FROM products WHERE record_id='R011'")).rows[0].id;
    await rc.del(`rs:prod:${rid}`);
    const b1 = new Client(); const b2 = new Client();
    await b1.login(`race1-${Date.now()}@verify.test`); await b2.login(`race2-${Date.now()}@verify.test`);
    await b1.req('/api/cart/add', { json: { id: rid, qty: 1 } }); await b2.req('/api/cart/add', { json: { id: rid, qty: 1 } });
    const body = { name: 'R', phone: '9876543210', line1: 'x', city: 'y', state: 'z', pin: '781001' };
    const [r1, r2] = await Promise.all([b1.req('/api/checkout', { json: body }), b2.req('/api/checkout', { json: body })]);
    const wins = [r1, r2].filter((r) => r.status === 200).length;
    ok('exactly one checkout succeeds, no oversell', wins === 1 && (await query('SELECT stock FROM products WHERE id=$1', [rid])).rows[0].stock === 0, `statuses ${r1.status}/${r2.status}`);
    await query("UPDATE products SET stock=14 WHERE record_id='R011'");

    // -------------------------------------------------------------- graceful degradation
    section('Graceful degradation when Valkey is down');
    const stop = await new Promise((res) => { const p = spawn('redis-cli', ['shutdown', 'nosave']); p.on('close', res); });
    await new Promise((r) => setTimeout(r, 900));
    const down = await c.req(`/api/products/${pr.id}/summary`);
    ok('summary falls back to PostgreSQL', down.status === 200 && down.json.cache === 'db', JSON.stringify(down.json));
    const hd = await c.req('/api/health');
    ok('health reports valkey down, db up, still 200', hd.status === 200 && hd.json.valkey.ok === false && hd.json.db.ok === true, JSON.stringify(hd.json));
    const shop = await c.req('/shop'); ok('storefront still renders', shop.status === 200);
    const addDown = await a.req('/api/cart/add', { json: { id: pr.id, qty: 1 } }); ok('cart still works', addDown.status === 200);
    spawn('redis-server', ['--port', '6379', '--daemonize', 'yes', '--save', ''], { stdio: 'ignore' });
  } finally {
    child.kill('SIGTERM');
  }
  try { rc.disconnect(); } catch (_) { /* ignore */ }
  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
