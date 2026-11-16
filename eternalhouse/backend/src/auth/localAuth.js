'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const cfg = require('../config/env');
const { query } = require('../db/pool');
const mail = require('../services/mail');
const { safeNext, establishSession } = require('./googleOAuth');
const { hashPassword, verifyPassword } = require('./passwords');

const router = express.Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validEmail = (email) => email.length <= 254 && emailPattern.test(email);
const authRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

function loginUrl(mode, error, next) {
  const params = new URLSearchParams({ mode, e: error, next });
  return '/login?' + params.toString();
}

router.post('/auth/signup', authRateLimit, async (req, res, next) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const nextUrl = safeNext(req.body.next);
  const passwordBytes = Buffer.byteLength(password, 'utf8');

  if (!name || name.length > 80 || !validEmail(email) || password.length < 12 || passwordBytes > 128) {
    return res.redirect(loginUrl('signup', 'invalid_signup', nextUrl));
  }

  try {
    const role = cfg.adminEmails.includes(email) ? 'admin' : 'customer';
    const { rows } = await query(
      `INSERT INTO users (email, name, password_hash, role, last_login)
       VALUES ($1,$2,$3,$4,now()) RETURNING id, email, name, picture, role`,
      [email, name, await hashPassword(password), role]);
    await establishSession(req, rows[0]);
    mail.queue(email, 'Welcome to EternalHouse', mail.templates.welcome(name), 'registration');
    res.redirect(nextUrl);
  } catch (e) {
    if (e.code === '23505') return res.redirect(loginUrl('signup', 'email_taken', nextUrl));
    next(e);
  }
});

router.post('/auth/login', authRateLimit, async (req, res, next) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const nextUrl = safeNext(req.body.next);
  const valid = validEmail(email) && Buffer.byteLength(password, 'utf8') <= 128;

  try {
    const { rows } = valid
      ? await query('SELECT id, email, name, picture, role, password_hash FROM users WHERE email=$1', [email])
      : { rows: [] };
    const user = rows[0];
    const matches = await verifyPassword(valid ? password : '', user && user.password_hash);
    if (!valid || !user || !user.password_hash || !matches) {
      return res.redirect(loginUrl('login', 'invalid_credentials', nextUrl));
    }

    await query('UPDATE users SET last_login=now() WHERE id=$1', [user.id]);
    await establishSession(req, user);
    res.redirect(nextUrl);
  } catch (e) { next(e); }
});

module.exports = router;
