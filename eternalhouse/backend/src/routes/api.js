'use strict';
const express = require('express');
const cfg = require('../config/env');
const { query } = require('../db/pool');
const valkey = require('../cache/valkey');
const cart = require('../services/cart');
const orders = require('../services/orders');
const mail = require('../services/mail');

const router = express.Router();
const int = (v, d, min, max) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : d; };
const needUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Please sign in', login: '/login' }));
const needAdmin = (req, res, next) => (req.user && req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' }));

// ---- 2.0 Product & Cart Management ----
router.get('/products/:id/summary', async (req, res, next) => { // D2 read via Valkey (name, price, stock)
  try {
    const id = int(req.params.id, 0, 1, 1e9);
    const m = await valkey.getSummaries([id]);
    if (!m.has(id)) return res.status(404).json({ error: 'Not found' });
    res.set('Cache-Control', 'no-store').json({ id, ...m.get(id), cache: valkey.isHealthy() ? 'valkey' : 'db' });
  } catch (e) { next(e); }
});

async function cartPayload(req) {
  const items = await cart.list(cart.ownerKey(req));
  return { items, totals: cart.totals(items, req.session && req.session.coupon) };
}
router.get('/cart', needUser, async (req, res, next) => { try { res.set('Cache-Control', 'no-store').json(await cartPayload(req)); } catch (e) { next(e); } });

router.post('/cart/add', needUser, async (req, res, next) => {
  try {
    const r = await cart.add(cart.ownerKey(req), int(req.body.id, 0, 1, 1e9), int(req.body.qty, 1, 1, 10));
    if (r.error) return res.status(r.status).json({ error: r.error });
    const p = await cartPayload(req);
    res.json({ ok: true, count: p.totals.count });
  } catch (e) { next(e); }
});
router.post('/cart/set', needUser, async (req, res, next) => {
  try {
    const k = cart.ownerKey(req);
    await cart.setQty(k, int(req.body.id, 0, 1, 1e9), int(req.body.qty, 0, 0, 10));
    res.json({ ok: true, ...(await cartPayload(req)) });
  } catch (e) { next(e); }
});
router.post('/cart/coupon', needUser, async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase().slice(0, 20);
  if (!code) { delete req.session.coupon; return res.json({ ok: true }); }
  if (!cart.COUPONS[code]) return res.status(400).json({ error: 'That code is not valid' });
  req.session.coupon = code;
  res.json({ ok: true, code });
});

// ---- 3.0 Order & Checkout Processing ----
router.post('/checkout', needUser, async (req, res, next) => {
  try {
    const b = req.body;
    const clean = (v, n) => String(v || '').trim().slice(0, n);
    const ship = { name: clean(b.name, 80), phone: clean(b.phone, 15), line1: clean(b.line1, 160), city: clean(b.city, 60), state: clean(b.state, 60), pin: clean(b.pin, 10) };
    if (!ship.name || !/^[0-9+\- ]{7,15}$/.test(ship.phone) || !ship.line1 || !ship.city || !ship.state || !/^[0-9]{6}$/.test(ship.pin)) {
      return res.status(400).json({ error: 'Please complete the shipping details (6-digit PIN, valid phone).' });
    }
    const r = await orders.create(req.user, 'u:' + req.user.id, ship, req.session.coupon);
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true, orderId: r.order.id, orderNo: r.order.order_no, total: r.order.total, provider: r.provider,
      paymentSessionId: r.paymentSessionId, mode: r.mode });
  } catch (e) {
    if (e.code === 'CASHFREE_CREATE_FAILED') {
      console.error('[checkout] Cashfree order creation failed:', e.message);
      return res.status(502).json({ error: 'Could not start Cashfree checkout. Verify your sandbox credentials and check the server logs.' });
    }
    next(e);
  }
});

router.post('/checkout/mock-pay', needUser, async (req, res, next) => { // only when no Cashfree keys (dev/test)
  try {
    if (cfg.paymentMode !== 'mock') return res.status(404).json({ error: 'Not available' });
    const o = await orders.markPaid(String(req.body.orderId || ''), req.user.id, 'mock_' + Date.now());
    if (!o) return res.status(409).json({ error: 'Order not payable' });
    delete req.session.coupon;
    res.json({ ok: true, orderNo: o.order_no });
  } catch (e) { next(e); }
});

// Cashfree redirects the customer here after payment. Status is confirmed with Cashfree server-to-server.
router.get('/checkout/return', async (req, res, next) => {
  try {
    if (!req.user) return res.redirect('/login?next=%2Forders');
    if (cfg.paymentMode !== 'cashfree') return res.redirect('/checkout');
    const { rows } = await query('SELECT id, order_no, total, status FROM orders WHERE order_no=$1 AND user_id=$2',
      [String(req.query.order_id || '').slice(0, 50), req.user.id]);
    const o = rows[0];
    if (!o) return res.redirect('/orders');
    if (o.status !== 'pending_payment') return res.redirect('/orders/' + o.order_no); // already settled (idempotent)
    const c = await orders.cashfreeConfirm(o);
    if (!c.paid) return res.redirect('/checkout?e=payment_failed');
    await orders.markPaid(o.id, req.user.id, c.paymentId);
    delete req.session.coupon;
    res.redirect('/orders/' + o.order_no);
  } catch (e) { next(e); }
});

// ---- 5.0 Inventory & Admin Management ----
router.post('/admin/products/:id', needAdmin, async (req, res, next) => {
  try {
    const id = int(req.params.id, 0, 1, 1e9);
    const b = req.body;
    const price = b.price_inr === undefined ? null : int(b.price_inr, -1, 199, 499);
    const stock = b.stock === undefined ? null : int(b.stock, -1, 0, 1e6);
    if (price === -1 || stock === -1) return res.status(400).json({ error: 'Invalid number' });
    const active = b.active === undefined ? null : b.active === true || b.active === 'true';
    const { rows } = await query(
      `UPDATE products SET price_inr=COALESCE($2,price_inr), stock=COALESCE($3,stock), active=COALESCE($4,active), updated_at=now()
        WHERE id=$1 RETURNING id, price_inr, stock, active`, [id, price, stock, active]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    await valkey.evict([id]);
    res.json({ ok: true, product: rows[0] });
  } catch (e) { next(e); }
});
router.post('/admin/users/:id/role', needAdmin, async (req, res, next) => {
  try {
    const role = req.body.role === 'admin' ? 'admin' : 'customer';
    if (req.params.id === req.user.id && role !== 'admin') return res.status(400).json({ error: 'You cannot demote yourself' });
    const { rowCount } = await query('UPDATE users SET role=$2 WHERE id=$1', [req.params.id, role]).catch(() => ({ rowCount: 0 }));
    res.status(rowCount ? 200 : 404).json(rowCount ? { ok: true } : { error: 'Not found' });
  } catch (e) { next(e); }
});
const STATUSES = ['paid', 'processing', 'shipped', 'delivered', 'cancelled'];
router.post('/admin/orders/:id/status', needAdmin, async (req, res, next) => {
  try {
    const st = String(req.body.status);
    if (!STATUSES.includes(st)) return res.status(400).json({ error: 'Bad status' });
    const { rows } = await query(
      `UPDATE orders o SET status=$2 WHERE o.id=$1 AND o.status<>'pending_payment'
       RETURNING o.id, o.order_no, o.user_id`, [req.params.id, st]).catch(() => ({ rows: [] }));
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    if (st === 'shipped' || st === 'delivered' || st === 'cancelled') { // 5.0 <-> 4.0 alert emails
      const u = await query('SELECT email FROM users WHERE id=$1', [rows[0].user_id]);
      mail.queue(u.rows[0].email, `Order ${rows[0].order_no} ${st}`, mail.templates.alert(`Order ${st}`, `Your order ${rows[0].order_no} is now ${st}.`), 'order_alert');
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
