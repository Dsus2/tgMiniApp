// A per-browser-session id so the server (cart + chat) can keep state per
// customer. In a real Telegram context the proper identity is the
// WebApp's initData user id (HMAC-verifiable server-side); using a random
// id persisted in localStorage is enough for this prototype and works
// identically whether or not the page is actually opened inside Telegram.
const KEY = 'iikogate_session_id';
let memoryFallback: string | null = null;

export function getSessionId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // Private-browsing / blocked storage — stable for this page load only.
    if (!memoryFallback) memoryFallback = crypto.randomUUID();
    return memoryFallback;
  }
}
