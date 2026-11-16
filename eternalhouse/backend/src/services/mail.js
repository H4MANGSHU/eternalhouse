'use strict';
/**
 * 4.0 Email Notification Service. Every message is written to email_outbox (audit trail), then sent
 * through the OAuth email provider (Gmail API using a stored refresh token) when GMAIL_REFRESH_TOKEN
 * is configured; otherwise it is marked "logged" (dev) so flows are testable without credentials.
 */
const cfg = require('../config/env');
const { query } = require('../db/pool');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shell = (title, inner) =>
  `<div style="font-family:Georgia,serif;background:#0b0b0c;color:#f4efe6;padding:32px;max-width:560px">` +
  `<div style="letter-spacing:.4em;color:#c9a45c;font-size:12px">ETERNALHOUSE · STYLE NEVER DIES</div><h1 style="font-weight:400">${esc(title)}</h1>${inner}</div>`;
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');

const templates = {
  welcome: (name) => shell(`Welcome, ${name || 'friend'}`, '<p>Your account is verified. Explore the 2026 house of icons.</p>'),
  orderReceipt: (o, items) => shell(`Order ${o.order_no} confirmed`,
    '<table style="width:100%;color:#f4efe6">' + items.map((i) => `<tr><td>${esc(i.name)} × ${i.qty}</td><td align="right">${inr(i.price_inr * i.qty)}</td></tr>`).join('') +
    `</table><p>Total paid: <b>${inr(o.total)}</b></p>`),
  alert: (title, msg) => shell(title, `<p>${esc(msg)}</p>`),
};

let tokenCache = { t: 0, v: '' };
async function gmailAccessToken() {
  if (Date.now() < tokenCache.t) return tokenCache.v;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.google.clientId, client_secret: cfg.google.clientSecret,
      refresh_token: cfg.mail.refreshToken, grant_type: 'refresh_token' }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('gmail token: ' + (j.error || r.status));
  tokenCache = { v: j.access_token, t: Date.now() + (j.expires_in - 60) * 1000 };
  return tokenCache.v;
}

async function gmailSend(to, subject, html) {
  const raw = [`To: ${to}`, cfg.mail.from ? `From: ${cfg.mail.from}` : null,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '', html].filter((x) => x !== null).join('\r\n');
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { authorization: 'Bearer ' + (await gmailAccessToken()), 'content-type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(raw).toString('base64url') }),
  });
  if (!r.ok) throw new Error('gmail send ' + r.status);
}

// Brevo transactional API (api-key auth). Sender must be a verified sender/domain in the Brevo account.
function parseFrom(s) {
  const m = String(s || '').match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
  return m ? { name: (m[1] || '').trim() || 'EternalHouse', email: m[2].trim() } : { name: 'EternalHouse', email: String(s || '').trim() };
}
async function brevoSend(to, subject, html) {
  const r = await fetch(cfg.mail.brevoBase + '/v3/smtp/email', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { 'api-key': cfg.mail.brevoKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: parseFrom(cfg.mail.from), to: [{ email: to }], subject, htmlContent: html }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`brevo ${r.status}: ${j.message || j.code || ''}`);
  return j.messageId;
}

// Brevo SMTP relay (login = the SMTP login shown in Brevo, password = the xsmtpsib- SMTP key).
let smtpTx = null;
async function smtpSend(to, subject, html) {
  if (!smtpTx) {
    smtpTx = require('nodemailer').createTransport({ host: cfg.mail.smtp.host, port: cfg.mail.smtp.port, secure: cfg.mail.smtp.port === 465,
      auth: { user: cfg.mail.smtp.user, pass: cfg.mail.smtp.pass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
  }
  const info = await smtpTx.sendMail({ from: cfg.mail.from, to, subject, html });
  return info.messageId;
}

async function sendWithProvider(to, subject, html) {
  if (cfg.mail.provider === 'brevo') {
    if (!cfg.mail.brevoKey || !cfg.mail.from) throw new Error('MAIL_PROVIDER=brevo requires BREVO_API_KEY and MAIL_FROM');
    return { provider: 'brevo', messageId: await brevoSend(to, subject, html) };
  }
  if (cfg.mail.provider !== 'auto') throw new Error('MAIL_PROVIDER must be auto or brevo');
  if (cfg.mail.smtp.user && cfg.mail.smtp.pass && cfg.mail.from) {
    return { provider: 'smtp', messageId: await smtpSend(to, subject, html) };
  }
  if (cfg.mail.brevoKey && cfg.mail.from) {
    return { provider: 'brevo', messageId: await brevoSend(to, subject, html) };
  }
  if (cfg.mail.refreshToken && cfg.googleConfigured) {
    await gmailSend(to, subject, html);
    return { provider: 'gmail', messageId: null };
  }
  return null;
}

async function deliver(id, to, subject, html) {
  try {
    const sent = await sendWithProvider(to, subject, html);
    if (!sent) {
      await query("UPDATE email_outbox SET status='logged', sent_at=now() WHERE id=$1", [id]);
    } else {
      const ref = sent.messageId ? `${sent.provider}:${String(sent.messageId).slice(0, 120)}` : null;
      await query("UPDATE email_outbox SET status='sent', sent_at=now(), error=$2 WHERE id=$1", [id, ref]);
    }
  } catch (e) {
    await query("UPDATE email_outbox SET status='failed', error=$2 WHERE id=$1", [id, String(e.message).slice(0, 300)])
      .catch((updateError) => console.error('[mail] status update failed:', updateError.message));
    console.error('[mail] delivery failed:', e.message);
  }
}

// Fire-and-forget: never delays or fails a customer request.
function queue(to, subject, html, kind) {
  query('INSERT INTO email_outbox (to_email, subject, body, kind) VALUES ($1,$2,$3,$4) RETURNING id', [to, subject, html, kind])
    .then((r) => deliver(r.rows[0].id, to, subject, html))
    .catch((e) => console.error('[mail] queue failed:', e.message));
}

module.exports = { queue, templates, brevoSend, smtpSend, sendWithProvider };
