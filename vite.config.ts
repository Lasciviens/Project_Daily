import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // We register the service worker ourselves (src/main.tsx) via
      // virtual:pwa-register so it can force an update+reload — the
      // auto-injected register script is just a bare `.register()` call with
      // no update-detection logic at all.
      injectRegister: false,
      base: '/Project_Daily/',
      scope: '/Project_Daily/',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: "Lasci's Board",
        short_name: 'Board',
        description: 'Personal dashboard — daily planning, tasks, media, training',
        // Matched to the app's actual light-mode header/canvas surfaces —
        // the old #ef4444 red predated the amber/cream design entirely and
        // tinted the installed PWA's splash/chrome the wrong color.
        theme_color: '#FEFCF9',
        background_color: '#EDE4D5',
        display: 'standalone',
        start_url: '/Project_Daily/',
        scope: '/Project_Daily/',
        icons: [
          {
            src: '/Project_Daily/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/Project_Daily/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
        // #43 — home-screen long-press quick actions (Android; harmless on iOS).
        shortcuts: [
          { name: 'Personal', short_name: 'Personal', url: '/Project_Daily/#/daily',    icons: [{ src: '/Project_Daily/favicon.svg', sizes: 'any', type: 'image/svg+xml' }] },
          { name: 'Log food', short_name: 'Food',     url: '/Project_Daily/#/recipes',  icons: [{ src: '/Project_Daily/favicon.svg', sizes: 'any', type: 'image/svg+xml' }] },
          { name: 'Work',     short_name: 'Work',     url: '/Project_Daily/#/work',     icons: [{ src: '/Project_Daily/favicon.svg', sizes: 'any', type: 'image/svg+xml' }] },
          { name: 'Training', short_name: 'Training', url: '/Project_Daily/#/training', icons: [{ src: '/Project_Daily/favicon.svg', sizes: 'any', type: 'image/svg+xml' }] },
        ],
      },
      workbox: {
        // Web Push handlers (push + notificationclick) live in public/push-sw.js
        // and are imported into the Workbox-generated SW — generateSW mode can't
        // express them otherwise. Relative path so it resolves under the Pages base.
        importScripts: ['push-sw.js'],
        // Without these, a new service worker installs but sits "waiting"
        // until every open tab of the app is fully closed — a hard refresh
        // does NOT activate it (a hard refresh bypasses the HTTP cache, not
        // an already-controlling service worker). This was a real bug: a
        // shipped fix (stale Health chart dates) never appeared for the
        // user even after a successful deploy + hard refresh, because the
        // old service worker kept serving its own precached old bundle.
        // skipWaiting + clientsClaim make a new SW activate and take
        // control immediately; combined with registerSW({ immediate: true })
        // in main.tsx, updates are detected and applied automatically.
        skipWaiting: true,
        clientsClaim: true,
        // The main app bundle grew past workbox's default 2 MiB precache ceiling
        // (the app is feature-dense — recharts, the food library, etc.), which
        // FAILS the CI build ("Configure workbox.maximumFileSizeToCacheInBytes").
        // Raise the ceiling so the main chunk is precached with headroom; the
        // real long-term fix is code-splitting, tracked separately.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Cache static assets indefinitely
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/image\.tmdb\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tmdb-images',
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // Supabase API — always network, fall back to cache
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 50, maxAgeSeconds: 5 * 60 },
            },
          },
          {
            // Yr.no weather API
            urlPattern: /^https:\/\/api\.met\.no\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'weather-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 5, maxAgeSeconds: 30 * 60 },
            },
          },
          {
            // EnTur transit API
            urlPattern: /^https:\/\/api\.entur\.io\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'transit-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 10, maxAgeSeconds: 2 * 60 },
            },
          },
        ],
      },
    }),
  ],
  base: '/Project_Daily/',
})
