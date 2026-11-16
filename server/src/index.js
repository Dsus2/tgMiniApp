const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const menu = require('./menuCatalog');
const cart = require('./cartStore');
const agent = require('./agent');
const mockFlow = require('./mockFlow');
const telegramAuth = require('./telegramAuth');

const app = express();
app.use(cors({ origin: config.clientOrigin }));
app.use(express.json());

// Only reason this server exists: the browser must never see GATEWAY_API_KEY
// or GIGACHAT_AUTH_KEY. Everything the Mini App needs — catalog browsing,
// the shared cart, and the AI chat — goes through here.

// Coarse, IP-based ceiling on the whole API — just a backstop against a
// runaway script, not the real defense (see the per-session limiters
// below). Deliberately generous: in dev/prod here the browser's request
// goes through Vite's own proxy to this server (both on the same machine,
// see vite.config.ts), so every real customer's request arrives from the
// same local address as far as Express can tell — req.ip can't actually
// distinguish them. A tight limit here would risk throttling everyone
// during a genuine lunch-rush burst, not just an abuser.
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Resolves the real customer for a request. Telegram's WebApp initData is
// HMAC-signed with the bot token (see telegramAuth.js) — verifying it here
// means the session id a cart/chat request acts on is the one Telegram
// itself vouches for, not whatever string the client happened to send
// (previously: literally anyone's sessionId, since it was just a
// client-generated UUID in localStorage — see client/src/session.ts).
// TEST_MODE keeps accepting a bare client-supplied sessionId when no
// initData is present at all, so local/browser testing (outside Telegram)
// keeps working; initData that IS present but fails verification is never
// trusted, test mode or not.
function requireSession(req, res, next) {
  const initData = req.headers['x-telegram-init-data'] || req.body?.initData || req.query?.initData;
  const verified = telegramAuth.verifyInitData(initData, config.botToken);
  if (verified) {
    req.sessionId = verified.id;
    return next();
  }
  if (!initData && config.testMode) {
    const fallback = req.body?.sessionId || req.query?.sessionId;
    if (fallback) {
      req.sessionId = fallback;
      return next();
    }
  }
  res.status(401).json({ error: 'UNAUTHORIZED', message: 'Valid Telegram initData is required' });
}

app.get('/api/menu', async (req, res) => {
  try {
    res.json(await menu.getRawMenu());
  } catch (err) {
    console.error('Menu request failed:', err);
    res.status(502).json({ error: 'GATEWAY_UNREACHABLE', message: err.message });
  }
});

// --- Cart: single source of truth for both the button-driven screens and
// the AI chat (src/agent.js) — whichever one a session uses, the other sees
// the same state, keyed by the Telegram-verified session id (see
// requireSession above).

app.use('/api/cart', requireSession);

app.get('/api/cart', (req, res) => {
  res.json(cart.publicCart(req.sessionId));
});

// Keyed by the now-verified session id, not IP (see the global limiter's
// comment above for why IP doesn't work here) — generous enough for a real
// customer clicking around (a human adding items one tap at a time won't
// get near 60/min), tight enough to stop a scripted cart-spam loop.
const cartMutationLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.sessionId,
});

app.post('/api/cart/add', cartMutationLimiter, async (req, res) => {
  const { line } = req.body || {};
  if (!line) return res.status(400).json({ error: 'BAD_REQUEST', message: 'line is required' });
  const result = await cart.addLine(req.sessionId, line);
  if (!result.ok) return res.status(422).json(result);
  res.json(result);
});

app.post('/api/cart/remove', cartMutationLimiter, (req, res) => {
  const { lineId } = req.body || {};
  if (!lineId) return res.status(400).json({ error: 'BAD_REQUEST', message: 'lineId is required' });
  res.json(cart.removeLine(req.sessionId, lineId));
});

app.post('/api/cart/delivery', cartMutationLimiter, async (req, res) => {
  const { address, latitude, longitude } = req.body || {};
  if (!address) return res.status(400).json({ error: 'BAD_REQUEST', message: 'address is required' });
  const result = await cart.setDeliveryAddress(req.sessionId, address, { latitude, longitude });
  if (!result.ok) return res.status(422).json(result);
  res.json(result);
});

app.post('/api/cart/customer', cartMutationLimiter, (req, res) => {
  const { name, phone } = req.body || {};
  const result = cart.setCustomer(req.sessionId, { name, phone });
  if (!result.ok) return res.status(422).json(result);
  res.json(result);
});

// Starts checkout: creates a real YooKassa payment and returns its hosted
// page URL for the client to open. Does not move money or touch iiko by
// itself — see cartStore.js#startCheckout. Tightly rate-limited: each call
// can create a real payment object at YooKassa.
const checkoutLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.sessionId,
});
app.post('/api/cart/checkout', checkoutLimiter, async (req, res) => {
  const result = await cart.startCheckout(req.sessionId);
  if (!result.ok) return res.status(422).json(result);
  res.json(result);
});

// Test mode only — simulates the customer completing payment on YooKassa's
// page (see cartStore.js#mockConfirmPayment). Never exposed as a real
// capability: mockConfirmPayment itself refuses unless config.testMode is on.
app.post('/api/cart/mock-pay', (req, res) => {
  const result = cart.mockConfirmPayment(req.sessionId);
  if (!result.ok) return res.status(422).json(result);
  res.json(result);
});

// Polled by the client after the customer says they've paid (or on an
// interval) — only submits the real order to the gateway once YooKassa
// confirms the payment actually succeeded.
app.post('/api/cart/finalize', async (req, res) => {
  const result = await cart.finalizeOrder(req.sessionId);
  res.json(result);
});

app.post('/api/cart/reset', (req, res) => {
  cart.resetAfterOrder(req.sessionId);
  res.json({ ok: true });
});

// --- Order status tracking ----------------------------------------------

app.get('/api/order/:externalOrderId', async (req, res) => {
  if (mockFlow.isMockOrderId(req.params.externalOrderId)) {
    return res.json(mockFlow.getMockOrderStatus(req.params.externalOrderId));
  }
  try {
    const gwRes = await fetch(`${config.gatewayBaseUrl}/v1/orders/${encodeURIComponent(req.params.externalOrderId)}?refresh=true`, {
      headers: { 'X-API-Key': config.gatewayApiKey },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await gwRes.json();
    if (!gwRes.ok) return res.status(gwRes.status).json(body);
    res.json(body);
  } catch (err) {
    console.error('Order status request failed:', err);
    res.status(502).json({ error: 'GATEWAY_UNREACHABLE', message: err.message });
  }
});

// --- AI chat (GigaChat) -----------------------------------------------

app.use('/api/chat', requireSession);

// Each message is a real GigaChat API call (costs money and takes
// seconds) — capped well below what a real conversation ever needs, so a
// script can't run up the bill or hammer the chat loop.
const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.sessionId,
});

app.post('/api/chat', chatLimiter, async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'BAD_REQUEST', message: 'message is required' });
  try {
    res.json(await agent.handleMessage(req.sessionId, message));
  } catch (err) {
    console.error('Agent error:', err);
    res.status(502).json({ error: 'AGENT_ERROR', message: err.message });
  }
});

app.post('/api/chat/reset', (req, res) => {
  agent.resetConversation(req.sessionId);
  res.json({ ok: true });
});

app.get('/health', (req, res) => res.json({ ok: true }));

menu
  .load()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`Mini App API server listening on http://localhost:${config.port}`);
    });
  })
  .catch((err) => {
    console.error('Failed to load menu at startup:', err.message);
    process.exit(1);
  });
