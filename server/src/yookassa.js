const crypto = require('crypto');
const config = require('./config');

const BASE_URL = 'https://api.yookassa.ru/v3';

function authHeader() {
  const token = Buffer.from(`${config.yookassa.shopId}:${config.yookassa.secretKey}`).toString('base64');
  return `Basic ${token}`;
}

/**
 * Creates a real YooKassa payment and returns its hosted confirmation page
 * URL — creating the payment object does NOT move any money by itself;
 * nothing is charged until the actual cardholder completes it on that page.
 * Idempotence-Key is required by YooKassa so a retried request (e.g. a
 * network blip) never creates a second charge for the same order.
 */
async function createPayment({ amount, description, idempotenceKey }) {
  const res = await fetch(`${BASE_URL}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(),
      'Idempotence-Key': idempotenceKey || crypto.randomUUID(),
    },
    body: JSON.stringify({
      amount: { value: amount.toFixed(2), currency: 'RUB' },
      confirmation: { type: 'redirect', return_url: config.returnUrl },
      capture: true,
      description,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`YooKassa createPayment failed: ${res.status} ${JSON.stringify(body)}`);
  return body; // { id, status, confirmation: { confirmation_url }, ... }
}

async function getPayment(paymentId) {
  const res = await fetch(`${BASE_URL}/payments/${paymentId}`, {
    headers: { Authorization: authHeader() },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`YooKassa getPayment failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

module.exports = { createPayment, getPayment };
