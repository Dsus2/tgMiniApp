import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@telegram-apps/telegram-ui/dist/styles.css';
import { AppRoot } from '@telegram-apps/telegram-ui';
import { initTelegram, getWebApp } from './telegram';
import App from './App.tsx';

initTelegram();
const platform = getWebApp() ? 'ios' : 'base'; // AppRoot just needs *a* platform; real one doesn't matter visually here
// 'light' default on purpose — if colorScheme isn't available yet (e.g. a
// plain browser preview outside Telegram), the page background stays
// browser-default white, so light-theme (dark) text must be the fallback.
// Defaulting to 'dark' here previously rendered white text with nothing
// dark behind it ("белый текст на белом фоне").
const colorScheme = getWebApp()?.colorScheme ?? 'light';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRoot platform={platform} appearance={colorScheme}>
      <App />
    </AppRoot>
  </StrictMode>,
);
