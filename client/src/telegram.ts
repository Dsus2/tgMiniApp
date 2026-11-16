// Minimal surface of the global Telegram.WebApp object injected by the
// telegram-web-app.js script tag (see index.html). Not using the
// @telegram-apps/sdk package here on purpose — it pulled in a deprecated,
// vulnerable (ReDoS) transitive dependency (valibot) for functionality we
// don't need yet (initData validation happens server-side once we wire real
// orders). This raw global is all a read-only menu browser + cart needs.
interface MainButtonParams {
  text?: string;
  color?: string;
  text_color?: string;
  is_active?: boolean;
  is_visible?: boolean;
}

interface MainButton {
  setText: (text: string) => void;
  setParams: (params: MainButtonParams) => void;
  show: () => void;
  hide: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
}

interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string | undefined>;
  initData: string;
  MainButton: MainButton;
  // Opens an external URL (the YooKassa hosted payment page) outside the
  // Mini App's own WebView — a plain <a href> / window.open can be blocked
  // or just feel wrong inside Telegram's frame.
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

// The server verifies this HMAC-signed string against the bot token to
// know which real Telegram user a cart/chat request is for (see
// server/src/telegramAuth.js) — empty outside a real Telegram WebApp (e.g.
// a plain browser during dev), which the server only accepts in TEST_MODE.
export function getInitData(): string {
  return window.Telegram?.WebApp?.initData ?? '';
}

// Keeps the page background in sync with Telegram's actual theme colors.
// Without this, a mismatch between our AppRoot "appearance" guess and the
// surrounding page background can render theme-light text on a dark
// background (or vice versa) — exactly the "white text on white background"
// bug: colorScheme read as 'dark' (white text) while body stayed browser-default
// white, because nothing had ever painted it to match.
export function syncBodyTheme(): void {
  const webApp = getWebApp();
  if (!webApp) return;
  const { bg_color, text_color } = webApp.themeParams;
  if (bg_color) document.body.style.backgroundColor = bg_color;
  if (text_color) document.body.style.color = text_color;
}

export function initTelegram(): void {
  const webApp = getWebApp();
  if (!webApp) return; // running in a plain browser outside Telegram, e.g. during dev
  webApp.ready();
  webApp.expand();
  syncBodyTheme();
}
