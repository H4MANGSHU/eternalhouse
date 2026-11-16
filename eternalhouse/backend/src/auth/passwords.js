'use strict';
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const HASH_PATTERN = /^scrypt\$16384\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
const DUMMY_SALT = Buffer.alloc(16);
const DUMMY_HASH = Buffer.alloc(KEY_LENGTH);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, OPTIONS);
  return `scrypt$16384$8$1$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  const match = typeof encoded === 'string' ? HASH_PATTERN.exec(encoded) : null;
  const salt = match ? Buffer.from(match[1], 'hex') : DUMMY_SALT;
  const expected = match ? Buffer.from(match[2], 'hex') : DUMMY_HASH;
  const derived = await scrypt(password, salt, KEY_LENGTH, OPTIONS);
  return !!match && crypto.timingSafeEqual(derived, expected);
}

module.exports = { hashPassword, verifyPassword };
