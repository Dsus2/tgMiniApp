import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // The browser only ever calls this single (eventually ngrok-tunneled)
      // origin; Vite relays /api/* to the Express backend on this same
      // machine, so Telegram's WebView never needs its own route to :4000.
      '/api': 'http://localhost:4000',
    },
    // ngrok's hostname isn't localhost, so Vite's Host-header check would
    // otherwise reject it ("Blocked request. This host is not allowed").
    allowedHosts: true,
  },
})
