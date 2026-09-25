import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import mkcert from 'vite-plugin-mkcert'

// Installable as an app (Android "Add to Home screen" / "Install app", iOS Safari "Add to Home Screen"):
// same server, same login, same data, just opened without the browser's address bar. The service worker only
// ever caches the app's own files (JS, CSS, icons); every /api call still goes straight to the live backend,
// nothing about hive, harvest, lab, order or finance data is ever cached or shown stale.
//
// A phone's browser only turns on a service worker over a secure origin (HTTPS, or "localhost" on this same
// computer). Plain http://<lan-ip>:5173 still lets a phone add the icon to its home screen and open it in its
// own standalone window, it just skips the offline app-shell caching until this is served over HTTPS. Run
// with HTTPS=true to serve over a local, self-signed HTTPS certificate instead (the very first open on a
// phone will ask it to trust that certificate).
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(process.env.HTTPS === 'true' ? [mkcert()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon-32.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Honey Chain Keeper',
        short_name: 'HC Keeper',
        description: 'Smart beekeeping and honey traceability for a KVIC-registered keeper.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f4fbfb',
        theme_color: '#0F766E',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Only this app's own files are precached; a cross-origin call (the API on :5000, the IoT service on
        // :5001) is never a same-origin precache match, so Workbox's generated service worker leaves those
        // requests untouched and they go straight to the network, exactly as without a service worker.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { host: true, port: 5173, strictPort: true },
})
