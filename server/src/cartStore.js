const crypto = require('crypto');
const config = require('./config');
const menu = require('./menuCatalog');
const yookassa = require('./yookassa');
const mockFlow = require('./mockFlow');

// One cart per Mini App session (see client/src/session.ts for how the id
// is generated/persisted) — single source of truth for the button-driven
// flow, the AI chat (add_items_to_cart), and now the payment/order flow.
const carts = new Map();

function emptyCart() {
  return {
    lines: [],
    deliveryAddress: null,
    deliveryPrice: null,
    customerName: null,
    customerPhone: null,
    externalOrderId: null,
    paymentId: null,
    paymentStatus: null, // null | 'pending' | 'succeeded' | 'canceled'
    orderStatus: null, // null | 'created' | 'failed'
    lastOrderError: null,
  };
}

function getCart(sessionId) {
  if (!carts.has(sessionId)) carts.set(sessionId, emptyCart());
  return carts.get(sessionId);
}

function cartTotal(cart) {
  return cart.lines.reduce((sum, l) => sum + l.lineTotal, 0);
}

function publicCart(sessionId) {
  const cart = getCart(sessionId);
  const goodsTotal = cartTotal(cart);
  return {
    lines: cart.lines,
    goodsTotal,
    deliveryAddress: cart.deliveryAddress,
    deliveryPrice: cart.deliveryPrice,
    grandTotal: cart.deliveryPrice != null ? goodsTotal + cart.deliveryPrice : null,
    customerName: cart.customerName,
    customerPhone: cart.customerPhone,
    paymentStatus: cart.paymentStatus,
    orderStatus: cart.orderStatus,
    externalOrderId: cart.externalOrderId,
    lastOrderError: cart.lastOrderError,
  };
}

/**
 * Button flow: the client picks a product and which modifiers it wants, but
 * the PRICE is never taken from it — this is a browser-based Mini App, so
 * any field in that request is attacker-controlled (trivial to edit via
 * devtools before it's sent). Recomputes unitPrice/lineTotal from the real
 * catalog server-side, exactly like the AI path (addItemsByName) already
 * does, so a tampered request can't buy a real dish for an arbitrary price.
 */
async function addLine(sessionId, line) {
  const product = await menu.getProduct(line?.productId);
  if (!product) return { ok: false, error: 'Товар не найден в меню' };

  const qty = Math.max(1, Math.min(50, Math.round(Number(line.qty) || 1)));
  const requestedIds = new Set((Array.isArray(line.modifiers) ? line.modifiers : []).map((m) => m?.productId).filter(Boolean));

  // Re-derive each requested modifier from the catalog by id — name, group
  // and price all come from here, never from the client.
  let chosen = [];
  for (const group of product.modifierGroups || []) {
    for (const ref of group.items || []) {
      if (!requestedIds.has(ref.id)) continue;
      const modifier = await menu.getModifier(ref.id);
      if (modifier) chosen.push({ productId: ref.id, groupId: group.id, name: modifier.name, price: menu.modifierLinePrice(modifier) });
    }
  }
  chosen = await menu.fillRequiredModifiers(product, chosen);

  const unresolved = await menu.unresolvedRequiredGroups(product, chosen);
  if (unresolved.length) {
    return { ok: false, error: `Не выбран обязательный вариант: ${unresolved.map((g) => g.groupName).join(', ')}` };
  }

  const basePrice = product.sizePrices?.[0]?.price ?? 0;
  const unitPrice = basePrice + chosen.reduce((sum, m) => sum + (m.price || 0), 0);
  const lineTotal = unitPrice * qty;

  const cart = getCart(sessionId);
  cart.lines.push({
    id: `${product.productId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    productId: product.productId,
    groupId: product.groupId,
    name: product.name,
    qty,
    unitPrice,
    lineTotal,
    modifierNames: chosen.map((m) => m.name),
    modifiers: chosen.map(({ productId, groupId, price }) => ({ productId, groupId, price })),
  });
  return { ok: true, ...publicCart(sessionId) };
}

/**
 * AI flow: GigaChat only emits one function_call per turn (confirmed in
 * testing — "two pepperoni and a cola" called the tool once and dropped the
 * cola when it only took a single item), so this takes an array and
 * resolves each name against the real catalog itself — never trusts the
 * model's text as already being a valid product.
 */
async function addItemsByName(sessionId, items) {
  const cart = getCart(sessionId);
  const added = [];
  const notFound = [];
  const modifiersNotFound = [];
  const needsChoice = [];

  for (const item of items || []) {
    const product = await menu.searchProduct(item.product_name || '');
    if (!product) {
      notFound.push(item.product_name);
      continue;
    }
    const qty = Math.max(1, Math.round(item.quantity || 1));

    // Resolve whatever modifiers the customer actually asked for (scoped to
    // THIS product's own modifier groups only), then fill in anything iiko
    // marks required where every option costs the same (safe to default).
    let chosen = [];
    for (const text of item.modifiers || []) {
      const match = await menu.searchProductModifier(product, text);
      if (match) chosen.push({ productId: match.modifier.id, groupId: match.group.id, name: match.modifier.name, price: menu.modifierLinePrice(match.modifier) });
      else modifiersNotFound.push(text);
    }
    chosen = await menu.fillRequiredModifiers(product, chosen);

    // A required group that's still unresolved here is a priced size/variant
    // choice (e.g. "Донер Хан" is 0₽ on its own — S/M/L at 275/362/406₽ is
    // the ENTIRE price) — never guess one, that would charge the customer
    // for a size they never picked. Refuse the whole line instead and
    // report the real options so the AI can ask.
    const unresolved = await menu.unresolvedRequiredGroups(product, chosen);
    if (unresolved.length) {
      needsChoice.push({ name: product.name, groups: unresolved });
      continue;
    }

    const basePrice = product.sizePrices?.[0]?.price ?? 0;
    const modifiersPrice = chosen.reduce((sum, m) => sum + (m.price || 0), 0);
    const unitPrice = basePrice + modifiersPrice;
    const lineTotal = unitPrice * qty;
    cart.lines.push({
      id: `${product.productId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      productId: product.productId,
      groupId: product.groupId,
      name: product.name,
      qty,
      unitPrice,
      lineTotal,
      modifierNames: chosen.map((m) => m.name),
      modifiers: chosen.map(({ productId, groupId, price }) => ({ productId, groupId, price })),
    });
    added.push({ name: product.name, qty, lineTotal, modifierNames: chosen.map((m) => m.name) });
  }

  return { added, notFound, modifiersNotFound, needsChoice, cartTotal: cartTotal(cart) };
}

function removeLine(sessionId, lineId) {
  const cart = getCart(sessionId);
  cart.lines = cart.lines.filter((l) => l.id !== lineId);
  return publicCart(sessionId);
}

// Removes at most ONE line, not every line whose name happens to contain
// the text — a substring match against ALL lines would wipe both "Evervess
// Cola 0,3л" and "...0,5л" from one "убери колу", or an unrelated dish that
// just shares a word. Prefers an exact name match; falls back to the first
// partial match only if there's no exact one.
function removeByName(sessionId, productName) {
  const cart = getCart(sessionId);
  const q = (productName || '').toLowerCase().trim();
  const exactIndex = cart.lines.findIndex((l) => l.name.toLowerCase() === q);
  const index = exactIndex !== -1 ? exactIndex : cart.lines.findIndex((l) => l.name.toLowerCase().includes(q));
  if (index === -1) return { removed: false, cartTotal: cartTotal(cart) };
  cart.lines.splice(index, 1);
  return { removed: true, cartTotal: cartTotal(cart) };
}

async function setDeliveryAddress(sessionId, address, coords) {
  const cart = getCart(sessionId);
  try {
    const deliveryAddress = { line1: address };
    // Coordinates from the map picker skip the gateway's own text geocoding
    // (DaData) entirely — more reliable, and it's what we already have once
    // the customer drops a pin instead of typing.
    if (coords?.latitude != null && coords?.longitude != null) {
      deliveryAddress.latitude = coords.latitude;
      deliveryAddress.longitude = coords.longitude;
    }
    const res = await fetch(`${config.gatewayBaseUrl}/v1/delivery-price`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': config.gatewayApiKey },
      body: JSON.stringify({ organizationId: config.organizationId, deliveryAddress }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json();
    if (!res.ok) {
      cart.deliveryAddress = null;
      cart.deliveryPrice = null;
      return { ok: false, error: body.message || `HTTP ${res.status}` };
    }
    cart.deliveryAddress = address;
    cart.deliveryPrice = Number(body.price?.total_price_with_vat ?? body.price?.total_price ?? 0);
    return { ok: true, ...publicCart(sessionId) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function setCustomer(sessionId, { name, phone }) {
  const cart = getCart(sessionId);
  if (!name || !name.trim()) return { ok: false, error: 'Укажите имя' };
  if (!/^\+[0-9]{5,15}$/.test(phone || '')) return { ok: false, error: 'Телефон должен быть в формате +79991234567' };
  cart.customerName = name.trim();
  cart.customerPhone = phone;
  return { ok: true, ...publicCart(sessionId) };
}

/**
 * Starts checkout: creates a REAL YooKassa payment for the full amount
 * (goods + delivery). Creating the payment object does not move any money
 * by itself — nothing is charged until the customer completes it on
 * YooKassa's own hosted page (confirmationUrl, returned here for the client
 * to open). Idempotent on retries: reuses the same externalOrderId/payment
 * once started, rather than creating a second charge.
 */
async function startCheckout(sessionId) {
  const cart = getCart(sessionId);
  if (cart.lines.length === 0) return { ok: false, error: 'Корзина пуста' };
  if (cart.deliveryPrice == null) return { ok: false, error: 'Сначала укажите адрес доставки' };
  if (!cart.customerName || !cart.customerPhone) return { ok: false, error: 'Укажите имя и телефон' };

  if (cart.paymentId && cart.paymentStatus === 'pending') {
    // Already started (e.g. the customer re-opened the app) — don't create
    // a second payment for the same order.
    return { ok: true, paymentId: cart.paymentId, confirmationUrl: cart.confirmationUrl };
  }

  // Guards the gap between the check above and yookassa.createPayment()
  // actually setting cart.paymentId below — without this, two overlapping
  // requests (a double-tap, or a client retry while the first is still
  // in flight) would both pass the check above and each create a REAL
  // YooKassa payment for the same order. Set synchronously, before any
  // await, so there's no window for a second call to slip through.
  if (cart.checkoutInFlight) return { ok: false, error: 'Оплата уже оформляется — подождите' };
  cart.checkoutInFlight = true;

  try {
    if (!cart.externalOrderId) cart.externalOrderId = `miniapp-${sessionId}-${Date.now()}`;
    const grandTotal = cartTotal(cart) + cart.deliveryPrice;

    if (config.testMode) {
      const payment = mockFlow.createMockPayment();
      cart.paymentId = payment.id;
      cart.paymentStatus = payment.status;
      cart.confirmationUrl = null; // nothing to open — client shows an "emulate payment" button instead
      return { ok: true, paymentId: payment.id, confirmationUrl: null, mock: true };
    }

    const payment = await yookassa.createPayment({
      amount: grandTotal,
      description: `Заказ ${cart.externalOrderId}`,
      idempotenceKey: cart.externalOrderId,
    });
    cart.paymentId = payment.id;
    cart.paymentStatus = payment.status;
    cart.confirmationUrl = payment.confirmation?.confirmation_url || null;
    return { ok: true, paymentId: payment.id, confirmationUrl: cart.confirmationUrl };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    cart.checkoutInFlight = false;
  }
}

// Test-mode only: simulates the customer completing payment on YooKassa's
// page, without any real page or any real money ever existing.
function mockConfirmPayment(sessionId) {
  const cart = getCart(sessionId);
  if (!config.testMode) return { ok: false, error: 'TEST_MODE is off' };
  if (!cart.paymentId) return { ok: false, error: 'Оплата ещё не начата' };
  cart.paymentStatus = 'succeeded';
  return { ok: true };
}

// Safety net: whatever cart line came from (button flow, AI chat, or an
// older line saved before modifiers existed at all), re-check its required
// modifier groups right before the real order goes out — never let a
// missing required pick reach iiko only to be rejected there, after the
// customer already paid. No `price` on modifiers themselves (only
// productId/amount) — item.price already includes their cost, and the
// gateway's own total check would double-count it otherwise.
async function resolveOrderItems(cart) {
  const items = [];
  for (const l of cart.lines) {
    const product = await menu.getProduct(l.productId);
    if (!product) {
      items.push({ productId: l.productId, amount: l.qty, price: l.unitPrice });
      continue;
    }
    const modifiers = await menu.fillRequiredModifiers(product, l.modifiers || []);
    // Anything still unresolved here is a priced size/variant pick (e.g.
    // "Донер Хан" S/M/L) — never guess one post-payment, that would charge
    // for a size the customer didn't choose. Both the button UI and the AI
    // chat already refuse to let such a line form, so this should be
    // unreachable in practice; it's the last line of defense, not the
    // normal path. Checked in TEST_MODE too, on purpose — test mode is
    // supposed to catch exactly this kind of bug, not hide it.
    const unresolved = await menu.unresolvedRequiredGroups(product, modifiers);
    if (unresolved.length) {
      return { ok: false, error: `Для позиции "${l.name}" не выбран обязательный вариант (${unresolved.map((g) => g.groupName).join(', ')}) — вернитесь в меню и уточните выбор` };
    }
    items.push({
      productId: l.productId,
      amount: l.qty,
      price: l.unitPrice,
      ...(modifiers.length ? { modifiers: modifiers.map((m) => ({ productId: m.productId, amount: 1 })) } : {}),
    });
  }
  return { ok: true, items };
}

/**
 * Called after the customer says they've paid (or on a poll loop) —
 * checks the REAL payment status with YooKassa, and only once it's
 * genuinely 'succeeded' submits the order to the gateway. The gateway
 * independently re-verifies the same payment with YooKassa before ever
 * forwarding to iiko (see the main iikoGate's paymentVerification.js) —
 * this check here is just to avoid calling /v1/orders uselessly while
 * payment is still pending.
 */
async function finalizeOrder(sessionId) {
  const cart = getCart(sessionId);
  if (!cart.paymentId) return { ok: false, error: 'Оплата ещё не начата' };

  // The client polls this every few seconds while waiting for payment —
  // if one call is still waiting on YooKassa/the gateway (both have
  // multi-second timeouts) when the next tick fires, two overlapping
  // calls could both pass the "already created" checks below and submit
  // the order to iiko twice. Set synchronously, before any await.
  if (cart.finalizeInFlight) return { ok: false, error: 'Заказ уже оформляется — подождите' };
  cart.finalizeInFlight = true;

  try {
    return await finalizeOrderLocked(cart);
  } finally {
    cart.finalizeInFlight = false;
  }
}

async function finalizeOrderLocked(cart) {
  if (config.testMode) {
    // No real YooKassa call — cart.paymentStatus only ever changes here via
    // mockConfirmPayment(), simulating the customer completing payment.
    if (cart.paymentStatus !== 'succeeded') {
      return { ok: false, status: cart.paymentStatus, message: 'Оплата ещё не подтверждена (эмуляция)' };
    }
    if (cart.orderStatus === 'created') {
      return { ok: true, externalOrderId: cart.externalOrderId, grandTotal: cartTotal(cart) + cart.deliveryPrice };
    }
    const resolved = await resolveOrderItems(cart);
    if (!resolved.ok) {
      cart.orderStatus = 'failed';
      cart.lastOrderError = resolved.error;
      return resolved;
    }
    cart.externalOrderId = mockFlow.createMockOrder();
    cart.orderStatus = 'created';
    return { ok: true, externalOrderId: cart.externalOrderId, grandTotal: cartTotal(cart) + cart.deliveryPrice };
  }

  let payment;
  try {
    payment = await yookassa.getPayment(cart.paymentId);
  } catch (err) {
    return { ok: false, error: `Не удалось проверить оплату: ${err.message}` };
  }
  cart.paymentStatus = payment.status;

  if (payment.status === 'canceled') {
    return { ok: false, status: 'canceled', error: 'Оплата отменена' };
  }
  if (payment.status !== 'succeeded') {
    return { ok: false, status: payment.status, message: 'Оплата ещё не подтверждена' };
  }

  if (cart.orderStatus === 'created') {
    // Already submitted on a previous poll — don't submit twice.
    return { ok: true, externalOrderId: cart.externalOrderId, grandTotal: cartTotal(cart) + cart.deliveryPrice };
  }

  const grandTotal = cartTotal(cart) + cart.deliveryPrice;

  const resolved = await resolveOrderItems(cart);
  if (!resolved.ok) {
    cart.orderStatus = 'failed';
    cart.lastOrderError = resolved.error;
    return resolved;
  }
  const { items } = resolved;

  const orderPayload = {
    externalOrderId: cart.externalOrderId,
    organizationId: config.organizationId,
    terminalGroupId: config.terminalGroupId,
    serviceType: 'courier',
    deliveryAddress: { line1: cart.deliveryAddress },
    customer: { name: cart.customerName, phone: cart.customerPhone },
    items: [
      ...items,
      // Delivery fee as its own line item (a 0₽-by-default technical
      // product, priced explicitly here) — keeps the gateway's own
      // payments-vs-items total check consistent with the single combined
      // YooKassa charge. See config.js for why.
      { productId: config.deliveryFeeProductId, amount: 1, price: cart.deliveryPrice },
    ],
    payments: [
      {
        paymentTypeId: config.ycasPaymentTypeId,
        paymentTypeKind: 'External',
        sum: grandTotal,
        yookassaPaymentId: cart.paymentId,
      },
    ],
  };

  try {
    const res = await fetch(`${config.gatewayBaseUrl}/v1/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': config.gatewayApiKey },
      body: JSON.stringify(orderPayload),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json();
    if (!res.ok) {
      cart.orderStatus = 'failed';
      cart.lastOrderError = body.message || `HTTP ${res.status}`;
      return { ok: false, error: cart.lastOrderError, details: body };
    }
    cart.orderStatus = 'created';
    cart.lastOrderError = null;
    return { ok: true, externalOrderId: cart.externalOrderId, grandTotal };
  } catch (err) {
    cart.orderStatus = 'failed';
    cart.lastOrderError = err.message;
    return { ok: false, error: err.message };
  }
}

function resetAfterOrder(sessionId) {
  carts.set(sessionId, emptyCart());
}

module.exports = {
  getCart,
  publicCart,
  cartTotal,
  addLine,
  addItemsByName,
  removeLine,
  removeByName,
  setDeliveryAddress,
  setCustomer,
  startCheckout,
  mockConfirmPayment,
  finalizeOrder,
  resetAfterOrder,
};
