const crypto = require('crypto');

// Verifies Telegram's WebApp initData per the documented algorithm
// (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
// HMAC-SHA256 of the sorted "key=value" pairs (everything but `hash`),
// keyed by HMAC-SHA256(botToken, "WebAppData"). This is the one thing that
// actually proves a request came from a real Telegram user opening THIS
// bot's Mini App, rather than a client-generated id anyone can forge —
// see client/src/session.ts for why that alone was never real identity.
//
// Returns { id, firstName, username } for the Telegram user on success, or
// null if the signature is missing, wrong, or too old to trust (replay
// protection) — never throws, since "not valid" is a normal, expected
// outcome here (e.g. plain-browser dev with no Telegram context at all).
const MAX_AGE_SECONDS = 24 * 60 * 60;

function verifyInitData(initData, botToken, maxAgeSeconds = MAX_AGE_SECONDS) {
  if (!initData || !botToken) return null;

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const pairs = [];
  for (const [key, value] of params) pairs.push(`${key}=${value}`);
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(computedHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) return null;

  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    user = null;
  }
  if (!user || user.id == null) return null;

  return { id: String(user.id), firstName: user.first_name, username: user.username };
}

module.exports = { verifyInitData };
