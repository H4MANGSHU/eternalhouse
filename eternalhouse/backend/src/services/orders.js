'use strict';
// 3.0 Order & Checkout Processing: server-authoritative totals inside a deadlock-ordered FOR UPDATE tx.
const crypto = require('crypto');
const cfg = require('../config/env');
const { query, tx } = require('../db/pool');
const cart = require('./cart');
const valkey = require('../cache/valkey');
const mail = require('./mail');

const orderNo = () => 'EH-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();

const cfHeaders = () => ({ 'x-client-id': cfg.cashfree.appId, 'x-client-secret': cfg.cashfree.secret,
  'x-api-version': cfg.cashfree.version, 'content-type': 'application/json' });

// Gateway call: create the Cashfree order (order_id = our order_no) and get a payment_session_id for the browser.
async function cashfreeCreate(order, user, phone) {
  let r;
  try {
    r = await fetch(cfg.cashfree.apiBase + '/pg/orders', {
      method: 'POST', headers: cfHeaders(), signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        order_id: order.order_no, order_amount: Number(order.total), order_currency: 'INR',
        customer_details: { customer_id: 'u' + user.id, customer_email: user.email, customer_phone: phone, customer_name: user.name || undefined },
        order_meta: { return_url: cfg.appOrigin + '/api/checkout/return?order_id={order_id}' },
      }),
    });
  } catch (e) {
    e.code = 'CASHFREE_CREATE_FAILED';
    throw e;
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.payment_session_id) {
    const e = new Error('cashfree: ' + (j.message || r.status));
    e.code = 'CASHFREE_CREATE_FAILED';
    throw e;
  }
  return j.payment_session_id;
}

// Server-side confirmation: never trust the browser. Order must be PAID at Cashfree for exactly our amount.
async function cashfreeConfirm(order) {
  const base = cfg.cashfree.apiBase + '/pg/orders/' + encodeURIComponent(order.order_no);
  const r = await fetch(base, { headers: cfHeaders(), signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('cashfree: ' + (j.message || r.status));
  if (j.order_status !== 'PAID' || Number(j.order_amount) !== Number(order.total)) return { paid: false, status: j.order_status };
  const pr = await fetch(base + '/payments', { headers: cfHeaders(), signal: AbortSignal.timeout(10000) });
  const pays = await pr.json().catch(() => []);
  const ok = Array.isArray(pays) && pays.find((p) => p.payment_status === 'SUCCESS');
  return { paid: true, paymentId: String((ok && ok.cf_payment_id) || j.cf_order_id || 'cf') };
}

async function create(user, ownerKey, ship, couponCode) {
  const phone = String(ship.phone).replace(/\D/g, '').slice(-10);
  if (cfg.paymentMode === 'cashfree' && phone.length < 10) return { error: 'Enter a valid 10-digit mobile number.', status: 400 };
  const out = await tx(async (c) => {
    const { rows: items } = await c.query(
      `SELECT ci.product_id AS id, ci.qty, p.name, p.brand, p.price_inr AS price, p.stock
         FROM cart_items ci JOIN products p ON p.id = ci.product_id AND p.active
        WHERE ci.owner_key=$1 ORDER BY p.id FOR UPDATE OF p`, [ownerKey]); // ordered locks => no deadlocks
    if (!items.length) return { error: 'Your cart is empty', status: 400 };
    const short = items.find((i) => i.stock < i.qty);
    if (short) return { error: `Only ${short.stock} left of ${short.name}`, status: 409 };
    const t = cart.totals(items, couponCode);
    const no = orderNo();
    const { rows } = await c.query(
      `INSERT INTO orders (order_no, user_id, subtotal, discount, shipping, total, coupon, payment_provider, ship_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, order_no, total`,
      [no, user.id, t.subtotal, t.discount, t.shipping, t.total, t.coupon, cfg.paymentMode, ship]);
    const order = rows[0];
    for (const i of items) {
      await c.query('INSERT INTO order_items (order_id, product_id, name, brand, price_inr, qty) VALUES ($1,$2,$3,$4,$5,$6)',
        [order.id, i.id, i.name, i.brand, i.price, i.qty]);
      await c.query('UPDATE products SET stock = stock - $2, updated_at = now() WHERE id=$1', [i.id, i.qty]); // reserve
    }
    return { order, ids: items.map((i) => i.id) };
  });
  if (out.error) return out;
  await valkey.evict(out.ids);
  let providerOrderId = null, paymentSessionId = null;
  if (cfg.paymentMode === 'cashfree') {
    paymentSessionId = await cashfreeCreate(out.order, user, phone);
    providerOrderId = out.order.order_no;
    await query('UPDATE orders SET provider_order_id=$2, payment_provider=$3 WHERE id=$1', [out.order.id, providerOrderId, 'cashfree']);
  }
  return { order: out.order, provider: cfg.paymentMode, providerOrderId, paymentSessionId, mode: cfg.cashfree.env };
}

async function markPaid(orderId, userId, paymentId) {
  const { rows } = await query(
    `UPDATE orders SET status='paid', paid_at=now(), provider_payment_id=$3
      WHERE id=$1 AND user_id=$2 AND status='pending_payment' RETURNING id, order_no, total, user_id`,
    [orderId, userId, paymentId]);
  if (!rows[0]) return null;
  const o = rows[0];
  await query('DELETE FROM cart_items WHERE owner_key=$1', ['u:' + userId]);
  const [{ rows: items }, { rows: u }] = await Promise.all([
    query('SELECT name, price_inr, qty FROM order_items WHERE order_id=$1', [o.id]),
    query('SELECT email FROM users WHERE id=$1', [userId]),
  ]);
  mail.queue(u[0].email, `Order ${o.order_no} confirmed`, mail.templates.orderReceipt(o, items), 'order_receipt'); // 3.0 -> 4.0
  return o;
}

async function cancelStale() {
  const ids = await tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE orders SET status='cancelled' WHERE status='pending_payment' AND created_at < now() - interval '30 minutes' RETURNING id`);
    const touched = [];
    for (const o of rows) {
      const { rows: its } = await c.query('SELECT product_id, qty FROM order_items WHERE order_id=$1 ORDER BY product_id', [o.id]);
      for (const i of its) { await c.query('UPDATE products SET stock = stock + $2 WHERE id=$1', [i.product_id, i.qty]); touched.push(i.product_id); }
    }
    return touched;
  });
  if (ids.length) await valkey.evict(ids);
}
setInterval(() => cancelStale().catch(() => {}), 5 * 60 * 1000).unref();

module.exports = { create, markPaid, cashfreeConfirm, cancelStale };
