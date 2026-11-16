'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.MAIL_PROVIDER = 'brevo';
process.env.BREVO_API_KEY = 'test-brevo-api-key';
process.env.MAIL_FROM = 'EternalHouse Test wreckergaming6@gmail.com';
process.env.SMTP_USER = 'configured@smtp-brevo.com';
process.env.SMTP_KEY = 'test-brevo-smtp-key';

const cfg = require('../src/config/env');
const { sendWithProvider } = require('../src/services/mail');

test('explicit Brevo provider bypasses configured SMTP and sends transactionally', async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url: String(url), options };
    return { ok: true, status: 201, json: async () => ({ messageId: 'mock-message-id' }) };
  };
  try {
    const result = await sendWithProvider('customer@example.test', 'Welcome', '<p>Hello</p>');
    assert.equal(result.provider, 'brevo');
    assert.equal(result.messageId, 'mock-message-id');
    assert.equal(request.url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(JSON.parse(request.options.body).to[0].email, 'customer@example.test');
  } finally {
    global.fetch = originalFetch;
  }
});

test('explicit Brevo provider reports missing API configuration', async () => {
  const originalKey = cfg.mail.brevoKey;
  cfg.mail.brevoKey = '';
  try {
    await assert.rejects(
      sendWithProvider('customer@example.test', 'Welcome', '<p>Hello</p>'),
      /BREVO_API_KEY and MAIL_FROM/
    );
  } finally {
    cfg.mail.brevoKey = originalKey;
  }
});
