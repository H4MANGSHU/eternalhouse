'use strict';
// Usage: node scripts/test-mail.js [recipient] -> sends one real test email using MAIL_PROVIDER.
const cfg = require('../src/config/env');
const { sendWithProvider } = require('../src/services/mail');
(async () => {
  const to = process.argv[2] || (cfg.mail.from.match(/<([^>]+)>/) || [, cfg.mail.from])[1];
  if (!to) throw new Error('Set MAIL_FROM or pass a test recipient.');
  const sent = await sendWithProvider(to, 'EternalHouse test email', '<p>This is a one-time email delivery test.</p>');
  if (!sent) throw new Error('No email provider configured. Set SMTP, Brevo, or Gmail credentials.');
  console.log(sent.provider + ' accepted the test email' + (sent.messageId ? ' (message ID recorded).' : '.'));
})().catch((e) => {
  const m = String(e.message), hint =
    /535|Invalid login|Authentication/i.test(m) ? 'Wrong SMTP_USER or SMTP_KEY. Copy both from Brevo > SMTP & API > SMTP (login looks like xxxxxx001@smtp-brevo.com).' :
    /sender|not valid|not verified|rejected|550|553/i.test(m) ? 'Sender not accepted. Verify MAIL_FROM under Brevo > Senders, Domains & IPs; use a sender address verified by your provider.' :
    /unauthorized|invalid api|api key|401|403/i.test(m) ? 'Check BREVO_API_KEY in .env and verify it is an API v3 key.' :
    /ETIMEDOUT|ECONNREFUSED|ESOCKET|ECONNECTION/i.test(m) ? 'Port blocked by your network/host. Try SMTP_PORT=2525 or 465 in .env.' :
    /ENOTFOUND|EAI_AGAIN/.test(m) ? 'This machine cannot resolve the mail provider host (no internet/DNS).' : '';
  console.error('FAILED:', m); if (hint) console.error('FIX   :', hint); process.exit(1);
});
