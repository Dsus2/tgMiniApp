const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Agent } = require('undici');
const config = require('./config');

// GigaChat's TLS chain is signed by the Russian "Минцифры" Trusted Root CA,
// which isn't in Node's (or most systems') default trust store — plain
// fetch() fails with SELF_SIGNED_CERT_IN_CHAIN. NODE_EXTRA_CA_CERTS doesn't
// work here: it's only read once at process bootstrap, too early for a
// value set at runtime. A custom undici dispatcher carrying the CA is the
// one approach that actually works for a long-running process. Bundle
// downloaded from the official source (gu-st.ru, Gosuslugi's CDN) — see
// certs/russian_trusted_ca_bundle.crt (same file as ../../iikoGate-bot).
const caBundle = fs.readFileSync(path.join(__dirname, '..', 'certs', 'russian_trusted_ca_bundle.crt'));
const dispatcher = new Agent({ connect: { ca: caBundle } });

let cachedToken = null;
let cachedExpiresAt = 0;

// No timeout meant a genuine network hang on Sber's side would leave the
// Mini App's chat waiting forever with nothing in the logs. Both calls now
// fail loudly within this window instead.
const TIMEOUT_MS = 20_000;

async function getToken() {
  if (cachedToken && Date.now() < cachedExpiresAt - 60_000) return cachedToken;

  const res = await fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      RqUID: crypto.randomUUID(),
      Authorization: `Basic ${config.gigachat.authKey}`,
    },
    body: new URLSearchParams({ scope: config.gigachat.scope }),
    dispatcher,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err) => {
    throw new Error(`GigaChat OAuth request failed: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`);
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`GigaChat OAuth failed: ${res.status} ${JSON.stringify(body)}`);

  cachedToken = body.access_token;
  cachedExpiresAt = body.expires_at; // already an absolute ms timestamp
  return cachedToken;
}

/**
 * One chat-completion call. `functions` is GigaChat's own function-calling
 * format (not OpenAI's `tools` array) — a response has either `content` or
 * `function_call: { name, arguments }`, never both, and only ONE call per
 * turn (confirmed in testing — a multi-item request needs an array-shaped
 * tool, not multiple turns; see cartStore.js's addItemsByName).
 */
async function chat({ messages, functions }) {
  const token = await getToken();
  const payload = {
    model: 'GigaChat',
    messages,
    ...(functions ? { functions, function_call: 'auto' } : {}),
    temperature: 0.3, // low — order-taking agent, not a creative one
  };
  const res = await fetch('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
    dispatcher,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err) => {
    throw new Error(`GigaChat chat request failed: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`);
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`GigaChat chat failed: ${res.status} ${JSON.stringify(body)}`);
  return body.choices[0].message;
}

module.exports = { chat };
