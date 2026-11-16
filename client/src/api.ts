import type { MenuResponse, Group, Modifier } from './types';
import type { CartLine } from './lib/cart';
import { getSessionId } from './session';
import { getInitData } from './telegram';

export interface Catalog {
  groups: Group[];
  modifiersById: Map<string, Modifier>;
}

// Every cart/chat request carries this header so the server can verify it
// really came from this Telegram bot's Mini App (see
// server/src/telegramAuth.js) — the client-generated sessionId alone was
// never real identity, just a convenience key for local/dev testing
// outside Telegram (still sent in each body below, as the fallback the
// server accepts only in TEST_MODE).
function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('X-Telegram-Init-Data', getInitData());
  return fetch(path, { ...init, headers });
}

export async function loadCatalog(): Promise<Catalog> {
  const res = await fetch('/api/menu');
  if (!res.ok) throw new Error(`Menu request failed: ${res.status}`);
  const menu: MenuResponse = await res.json();

  // "Тех. папка" holds internal/technical line items (e.g. the delivery-fee
  // placeholder product used when submitting a real order — see the
  // server's cartStore.js) — not meant for customers to see or order from.
  const groups = (menu.itemsGroups || []).filter((g) => g.items?.length > 0 && !/тех\.?\s*папка/i.test(g.name));
  const modifiersById = new Map<string, Modifier>();
  for (const modifier of menu.modifiers || []) modifiersById.set(modifier.id, modifier);

  return { groups, modifiersById };
}

export function modifierPrice(modifier?: Modifier): number {
  return modifier?.sizePrices?.[0]?.price ?? 0;
}

// --- Shared cart (server-side, keyed by sessionId) ----------------------
// Single source of truth for both the button-driven screens and the AI
// chat — whichever one a session uses, the other sees the same state.

export interface CartState {
  lines: CartLine[];
  goodsTotal: number;
  deliveryAddress: string | null;
  deliveryPrice: number | null;
  grandTotal: number | null;
  customerName: string | null;
  customerPhone: string | null;
  paymentStatus: 'pending' | 'succeeded' | 'canceled' | null;
  orderStatus: 'created' | 'failed' | null;
  externalOrderId: string | null;
  lastOrderError: string | null;
}

async function cartJson(res: Response): Promise<CartState> {
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || body.error || `Request failed: ${res.status}`);
  return body;
}

export async function fetchCart(): Promise<CartState> {
  const res = await apiFetch(`/api/cart?sessionId=${encodeURIComponent(getSessionId())}`);
  return cartJson(res);
}

export async function addLineToCart(line: CartLine): Promise<CartState> {
  const res = await apiFetch('/api/cart/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: getSessionId(), line }),
  });
  return cartJson(res);
}

export async function removeLineFromCart(lineId: string): Promise<CartState> {
  const res = await apiFetch('/api/cart/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: getSessionId(), lineId }),
  });
  return cartJson(res);
}

export async function setCartDeliveryAddress(
  address: string,
  coords?: { latitude: number; longitude: number }
): Promise<CartState> {
  const res = await apiFetch('/api/cart/delivery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: getSessionId(), address, ...coords }),
  });
  return cartJson(res);
}

export async function setCartCustomer(name: string, phone: string): Promise<CartState> {
  const res = await apiFetch('/api/cart/customer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: getSessionId(), name, phone }),
  });
  return cartJson(res);
}

// Creates a real YooKassa payment and returns its hosted page URL. Does not
// move any money by itself — nothing is charged until the customer actually
// completes it on that page.
export async function startCheckout(): Promise<{ ok: boolean; paymentId?: string; confirmationUrl?: string | null; mock?: boolean; error?: string }> {
  const res = await apiFetch('/api/cart/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: getSessionId() }),
  });
  return res.json();
}

// Test-mode only — simulates completing payment, no real money or page
// involved. The server refuses this unless TEST_MODE is on.
export async function mockPay(): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch('/api/cart/mock-pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: getSessionId() }),
  });
  return res.json();
}

// Polled after the customer says they've paid — only submits the real order
// once YooKassa confirms the payment actually succeeded.
export async function finalizeOrder(): Promise<{ ok: boolean; status?: string; externalOrderId?: string; grandTotal?: number; error?: string; message?: string }> {
  const res = await apiFetch('/api/cart/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: getSessionId() }),
  });
  return res.json();
}

export async function resetCart(): Promise<void> {
  await apiFetch('/api/cart/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: getSessionId() }),
  });
}

export interface OrderStatus {
  status: string;
  deliveryStatus: string | null;
  iikoNumber: number | null;
  error: { message: string } | null;
}

export async function fetchOrderStatus(externalOrderId: string): Promise<OrderStatus> {
  const res = await fetch(`/api/order/${encodeURIComponent(externalOrderId)}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || `Order status request failed: ${res.status}`);
  return body;
}

// --- AI chat --------------------------------------------------------------

export async function sendChatMessage(message: string): Promise<{ reply: string; cart: CartState }> {
  const res = await apiFetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: getSessionId(), message }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || `Chat request failed: ${res.status}`);
  return body;
}
