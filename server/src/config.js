require('dotenv').config();

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

const config = {
  // Emulates the whole payment + order flow with fake data — no real
  // YooKassa payment is created and no real order reaches iiko. See
  // src/mockPaymentFlow.js. Flip to false once ready to take real orders.
  testMode: bool(process.env.TEST_MODE, false),
  port: Number(process.env.PORT) || 4000,
  gatewayBaseUrl: process.env.GATEWAY_BASE_URL || 'https://sb02-security.ru',
  gatewayApiKey: process.env.GATEWAY_API_KEY || '',
  organizationId: process.env.ORGANIZATION_ID || '',
  // This Mini App build is scoped to one branch (same org as ORGANIZATION_ID
  // above) — Коммунистическая 51's own terminal group, so real orders don't
  // need the gateway's zone resolver at all.
  terminalGroupId: process.env.TERMINAL_GROUP_ID || '',
  // The org's "YCAS" payment type id (gateway only accepts this code — see
  // the main iikoGate's ALLOWED_PAYMENT_TYPE_CODES). Fetched once and
  // hardcoded here rather than re-queried every order; re-check via
  // GET /v1/organizations/:id/payment-types if it ever needs to change.
  ycasPaymentTypeId: process.env.YCAS_PAYMENT_TYPE_ID || '',
  // "Блюдо Доставка" — a 0₽-by-default technical product in iiko's own
  // catalog, meant to carry the delivery fee as an explicit per-order price
  // override. Without this, a combined food+delivery YooKassa payment would
  // fail the gateway's own orderTotals check, which matches payments[].sum
  // against items[] total only (delivery isn't otherwise part of that math).
  deliveryFeeProductId: process.env.DELIVERY_FEE_PRODUCT_ID || '',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  // Same token as the Telegram bot (iikoGate-bot/.env) — needed here only to
  // verify the WebApp initData every cart/chat request carries, proving it
  // really came from that bot's Mini App and not a forged sessionId (see
  // src/telegramAuth.js). Required outside TEST_MODE.
  botToken: process.env.BOT_TOKEN || '',
  // Where the customer lands after paying on YooKassa's hosted page.
  returnUrl: process.env.RETURN_URL || 'https://t.me/sytyi_batyr_delivery_bot',
  gigachat: {
    authKey: process.env.GIGACHAT_AUTH_KEY || '',
    scope: process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS',
  },
  yookassa: {
    shopId: process.env.YOOKASSA_SHOP_ID || '',
    secretKey: process.env.YOOKASSA_SECRET_KEY || '',
  },
};

if (!config.gatewayApiKey) throw new Error('GATEWAY_API_KEY is not set (see .env.example)');
if (!config.organizationId) throw new Error('ORGANIZATION_ID is not set (see .env.example)');
if (!config.terminalGroupId) throw new Error('TERMINAL_GROUP_ID is not set (see .env.example)');
if (!config.ycasPaymentTypeId) throw new Error('YCAS_PAYMENT_TYPE_ID is not set (see .env.example)');
if (!config.deliveryFeeProductId) throw new Error('DELIVERY_FEE_PRODUCT_ID is not set (see .env.example)');
if (!config.testMode && (!config.yookassa.shopId || !config.yookassa.secretKey)) {
  throw new Error('YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY are not set (see .env.example) — real payments require them (or set TEST_MODE=true)');
}
if (!config.testMode && !config.botToken) {
  throw new Error('BOT_TOKEN is not set (see .env.example) — required outside TEST_MODE to verify Telegram initData (or set TEST_MODE=true)');
}

module.exports = config;
