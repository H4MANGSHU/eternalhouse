'use strict';
const express = require('express');
const { query } = require('../db/pool');
const cart = require('../services/cart');
const { safeNext } = require('../auth/googleOAuth');

const router = express.Router();
const PER_PAGE = 24;
const CATS = ['Accessory', 'Footwear', 'Outfit', 'Dress'];
const CAT_LABEL = { Accessory: 'Accessories', Footwear: 'Footwear', Outfit: 'Ready-to-wear', Dress: 'Dresses' };

const PRODUCT_COLS = `p.id, p.slug, p.name, p.brand, p.category, p.subcategory, p.gender, p.price_inr, p.stock, p.demand_signal, p.rank`;
const withMedia = (alias = 'p') => `(SELECT array_agg(url ORDER BY position) FROM product_media m WHERE m.product_id=${alias}.id AND m.kind='image') AS images`;

const requireLogin = (req, res, next) => (req.user ? next() : res.redirect('/login?next=' + encodeURIComponent(req.originalUrl)));
const requireAdmin = (req, res, next) => (req.user && req.user.role === 'admin' ? next() : res.status(403).render('error', { title: 'Forbidden', status: 403, message: 'Admins only.' }));
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

router.get('/', wrap(async (req, res) => {
  const [top, cats, stats, looks, brands, spot] = await Promise.all([
    query(`SELECT ${PRODUCT_COLS}, ${withMedia()} FROM products p WHERE active ORDER BY rank LIMIT 10`),
    query('SELECT category, count(*)::int AS n FROM products WHERE active GROUP BY category'),
    query('SELECT (SELECT count(*) FROM products WHERE active)::int AS products, (SELECT count(DISTINCT brand) FROM products WHERE active)::int AS brands, (SELECT count(*) FROM lookbook)::int AS looks'),
    query('SELECT id, title, designer, year FROM lookbook ORDER BY year NULLS LAST, id LIMIT 6'),
    query('SELECT brand FROM products WHERE active GROUP BY brand ORDER BY min(rank) LIMIT 24'),
    query(`SELECT ${PRODUCT_COLS}, ${withMedia()} FROM products p WHERE active AND stock > 0 ORDER BY price_inr, rank LIMIT 4`),
  ]);
  res.render('index', { title: 'EternalHouse — Style Never Dies', top: top.rows, cats: cats.rows, stats: stats.rows[0], looks: looks.rows,
    brands: brands.rows.map((b) => b.brand), spot: spot.rows, CAT_LABEL, CATS });
}));

router.get('/shop', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const cat = CATS.includes(req.query.cat) ? req.query.cat : '';
  const gender = ['Women', 'Men', 'Unisex'].includes(req.query.gender) ? req.query.gender : '';
  const sort = ['price_asc', 'price_desc', 'new', 'name'].includes(req.query.sort) ? req.query.sort : 'featured';
  const preset = { p1: [199, 299], p2: [300, 399], p3: [400, 499] }[req.query.price] || null;
  const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(499, Math.max(199, n)) : null; };
  const typedMin = num(req.query.min), typedMax = num(req.query.max);
  let min = typedMin, max = typedMax;
  if (min === null && max === null && preset) [min, max] = preset; // typed range wins over the preset
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  const brands = (await query('SELECT brand, count(*)::int AS n FROM products WHERE active GROUP BY brand ORDER BY brand')).rows;
  const brand = brands.some((b) => b.brand === req.query.brand) ? req.query.brand : '';
  const stock = req.query.stock === '1' ? '1' : '';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const where = ['p.active']; const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace(/\?/g, '$' + params.length)); };
  if (q) add('(p.name ILIKE ? OR p.brand ILIKE ? OR p.subcategory ILIKE ?)', `%${q.replace(/[%_\\]/g, '\\$&')}%`);
  if (cat) add('p.category = ?', cat);
  if (gender) add('(p.gender = ? OR p.gender = \'Unisex\')', gender);
  if (min !== null) add('p.price_inr >= ?', min);
  if (max !== null) add('p.price_inr <= ?', max);
  if (brand) add('p.brand = ?', brand);
  if (stock) where.push('p.stock > 0');
  const order = { featured: 'p.rank', price_asc: 'p.price_inr, p.rank', price_desc: 'p.price_inr DESC, p.rank', new: 'p.year DESC NULLS LAST, p.rank', name: 'p.name' }[sort];
  const W = where.join(' AND ');
  const [count, rows] = await Promise.all([
    query(`SELECT count(*)::int AS n FROM products p WHERE ${W}`, params),
    query(`SELECT ${PRODUCT_COLS}, ${withMedia()} FROM products p WHERE ${W} ORDER BY ${order} LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`, params),
  ]);
  const total = count.rows[0].n;
  res.render('shop', { title: 'Shop — EternalHouse', items: rows.rows, total, page, pages: Math.max(1, Math.ceil(total / PER_PAGE)),
    f: { q, cat, gender, sort, price: preset && !req.query.min && !req.query.max ? req.query.price : '', min: typedMin === null ? '' : typedMin, max: typedMax === null ? '' : typedMax, brand, stock },
    brands, CATS, CAT_LABEL });
}));

router.get('/product/:slug', wrap(async (req, res, next) => {
  const { rows } = await query(`SELECT p.*, ${withMedia()}, (SELECT url FROM product_media v WHERE v.product_id=p.id AND v.kind='video' LIMIT 1) AS video
                                  FROM products p WHERE p.slug=$1 AND p.active`, [req.params.slug]);
  if (!rows[0]) return next();
  const p = rows[0];
  const related = await query(`SELECT ${PRODUCT_COLS}, ${withMedia()} FROM products p WHERE active AND id<>$1 AND (category=$2 OR brand=$3)
                               ORDER BY (brand=$3) DESC, abs(price_inr-$4), rank LIMIT 4`, [p.id, p.category, p.brand, p.price_inr]);
  res.render('product', { title: `${p.brand} ${p.name} — EternalHouse`, p, related: related.rows, CAT_LABEL });
}));

router.get('/lookbook', wrap(async (req, res) => {
  const { rows } = await query('SELECT id, title, designer, category, year, note, source, link FROM lookbook ORDER BY year DESC NULLS LAST, id');
  res.render('lookbook', { title: 'The Archive — EternalHouse', looks: rows });
}));

router.get('/cart', requireLogin, wrap(async (req, res) => {
  const items = await cart.list(cart.ownerKey(req));
  res.render('cart', { title: 'Your bag — EternalHouse', items, t: cart.totals(items, req.session.coupon), FREE: cart.FREE_SHIPPING_AT });
}));

router.get('/checkout', requireLogin, wrap(async (req, res) => {
  const items = await cart.list('u:' + req.user.id);
  if (!items.length) return res.redirect('/cart');
  res.render('checkout', { title: 'Checkout — EternalHouse', items, t: cart.totals(items, req.session.coupon) });
}));

router.get('/orders', requireLogin, wrap(async (req, res) => {
  const { rows } = await query('SELECT order_no, status, total, created_at FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
  res.render('orders', { title: 'Your orders — EternalHouse', orders: rows });
}));

router.get('/orders/:no', requireLogin, wrap(async (req, res, next) => {
  const { rows } = await query('SELECT * FROM orders WHERE order_no=$1 AND user_id=$2', [req.params.no, req.user.id]);
  if (!rows[0]) return next();
  const items = await query('SELECT oi.*, p.slug FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE order_id=$1', [rows[0].id]);
  res.render('order', { title: `Order ${rows[0].order_no} — EternalHouse`, o: rows[0], items: items.rows });
}));

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(safeNext(req.query.next));
  const errs = { not_configured: 'Google sign-in is not configured on this server yet.', expired: 'That sign-in attempt expired. Please try again.',
    unverified: 'Your Google email is not verified.', failed: 'Sign-in failed. Please try again.', access_denied: 'Sign-in was cancelled.',
    invalid_credentials: 'Email or password is incorrect.', email_taken: 'An account already uses that email. Please sign in instead.',
    invalid_signup: 'Enter a name, a valid email, and a password of at least 12 characters.' };
  const mode = req.query.mode === 'signup' ? 'signup' : 'login';
  res.render('login', { title: mode === 'signup' ? 'Create account — EternalHouse' : 'Sign in — EternalHouse',
    next: safeNext(req.query.next), mode, error: errs[req.query.e] || (req.query.e ? 'Sign-in error.' : '') });
});

// ---- 5.0 Admin ----
router.get('/admin', requireLogin, requireAdmin, wrap(async (req, res) => {
  const tab = ['reports', 'products', 'orders', 'users', 'emails'].includes(req.query.tab) ? req.query.tab : 'reports';
  const data = {};
  if (tab === 'reports') {
    const [rev, st, top, low, usr, mails] = await Promise.all([
      query("SELECT COALESCE(sum(total),0)::int AS revenue, count(*)::int AS orders FROM orders WHERE status NOT IN ('pending_payment','cancelled')"),
      query('SELECT status, count(*)::int AS n FROM orders GROUP BY status ORDER BY status'),
      query(`SELECT oi.name, oi.brand, sum(oi.qty)::int AS units, sum(oi.qty*oi.price_inr)::int AS revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id
             WHERE o.status NOT IN ('pending_payment','cancelled') GROUP BY oi.name, oi.brand ORDER BY units DESC LIMIT 8`),
      query('SELECT id, name, brand, stock FROM products WHERE active AND stock <= 5 ORDER BY stock, rank LIMIT 12'),
      query('SELECT count(*)::int AS n FROM users'),
      query('SELECT status, count(*)::int AS n FROM email_outbox GROUP BY status'),
    ]);
    Object.assign(data, { rev: rev.rows[0], st: st.rows, top: top.rows, low: low.rows, users: usr.rows[0].n, mails: mails.rows });
  } else if (tab === 'products') {
    const q = String(req.query.q || '').trim().slice(0, 60);
    data.rows = (await query(`SELECT id, name, brand, category, price_inr, stock, active FROM products
      WHERE ($1='' OR name ILIKE '%'||$1||'%' OR brand ILIKE '%'||$1||'%') ORDER BY rank LIMIT 150`, [q])).rows; data.q = q;
  } else if (tab === 'orders') {
    data.rows = (await query(`SELECT o.id, o.order_no, o.status, o.total, o.created_at, u.email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 100`)).rows;
  } else if (tab === 'users') {
    data.rows = (await query('SELECT id, email, name, role, created_at, last_login FROM users ORDER BY created_at DESC LIMIT 200')).rows;
  } else {
    data.rows = (await query('SELECT id, to_email, subject, kind, status, created_at FROM email_outbox ORDER BY id DESC LIMIT 100')).rows;
  }
  res.render('admin', { title: 'Admin — EternalHouse', tab, data });
}));

module.exports = router;
