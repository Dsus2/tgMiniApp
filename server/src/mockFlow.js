const crypto = require('crypto');

// Emulates the whole payment + order lifecycle with fake data when
// config.testMode is on (see cartStore.js) — no real YooKassa payment is
// created, and no real order ever reaches the gateway/iiko. Mirrors the
// main iikoGate's own IIKO_MOCK_MODE/YOOKASSA_MOCK_MODE pattern, just local
// to this Mini App server.

const MOCK_ORDER_PREFIX = 'mock-order-';
const mockOrderCreatedAt = new Map(); // externalOrderId -> timestamp

function isMockOrderId(id) {
  return typeof id === 'string' && id.startsWith(MOCK_ORDER_PREFIX);
}

function createMockPayment() {
  return { id: `mock-payment-${crypto.randomUUID()}`, status: 'pending' };
}

function createMockOrder() {
  const externalOrderId = `${MOCK_ORDER_PREFIX}${crypto.randomUUID()}`;
  mockOrderCreatedAt.set(externalOrderId, Date.now());
  return externalOrderId;
}

// Status progresses on its own over time, purely for a believable test of
// the OrderStatus screen — seconds-since-creation thresholds, not real
// kitchen/courier events.
const TIMELINE = [
  { at: 0, deliveryStatus: null },
  { at: 6, deliveryStatus: 'CookingStarted' },
  { at: 16, deliveryStatus: 'CookingCompleted' },
  { at: 24, deliveryStatus: 'OnWay' },
  { at: 40, deliveryStatus: 'Delivered' },
];

function getMockOrderStatus(externalOrderId) {
  const createdAt = mockOrderCreatedAt.get(externalOrderId);
  if (!createdAt) return { status: 'failed', deliveryStatus: null, iikoNumber: null, error: { message: 'Mock order not found (server restarted?)' } };

  const elapsedSec = (Date.now() - createdAt) / 1000;
  let current = TIMELINE[0];
  for (const step of TIMELINE) {
    if (elapsedSec >= step.at) current = step;
  }
  return {
    status: 'accepted',
    deliveryStatus: current.deliveryStatus,
    iikoNumber: Math.floor(1000 + (createdAt % 9000)),
    error: null,
  };
}

module.exports = { isMockOrderId, createMockPayment, createMockOrder, getMockOrderStatus };
