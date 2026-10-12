import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import ts from 'typescript'
import path from 'node:path'
import { stampComponentSources } from './src/features/devRequests/pick/componentSourceTransform'

// Stamps each React component's root element with data-src="src/…/File.tsx#Name"
// (Dev Requests → Pick on page names the component and file it picked from).
// All builds; +~1% bundle. DEV_SRC_STAMP=0 turns it off (e.g. to measure).
// Insertions stay on their own line, so line numbers in sourcemaps hold.
function componentSourceStamp(): Plugin {
  const root = process.cwd()
  return {
    name: 'lasci:component-source-stamp',
    enforce: 'pre',
    apply: () => process.env.DEV_SRC_STAMP !== '0',
    transform(code, id) {
      const file = id.split('?')[0]
      if (!file.endsWith('.tsx') || file.includes('/node_modules/')) return null
      const rel = path.relative(root, file).split(path.sep).join('/')
      if (!rel.startsWith('src/')) return null
      const out = stampComponentSources(ts, code, rel)
      return out == null ? null : { code: out, map: null }
    },
  }
}

export default defineConfig({
  plugins: [
    componentSourceStamp(),
    react(),
    VitePWA({
      // 'prompt': a new version installs and WAITS; src/app/serviceWorkerUpdate.ts
      // lets it take over at a quiet moment (app in the background, or left
      // alone) and reloads then. 'autoUpdate' reloaded the page the moment a
      // deploy's worker was ready — on opening the app and mid-work.
      registerType: 'prompt',
      // We register the service worker ourselves (src/main.tsx).
      injectRegister: false,
      base: '/Project_Daily/',
      scope: '/Project_Daily/',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: "Lasci's Board",
        short_name: 'Board',
        description: 'Personal dashboard — daily planning, tasks, media, training',
        // Matched to the app's actual light-mode header/canvas surfaces —
        // the old #ef4444 red predated the amber/cream design entirely and
        // tinted the installed PWA's splash/chrome the wrong color.
        theme_color: '#F3F5F9',
        background_color: '#F3F5F9',
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
        // No skipWaiting: the new worker waits until serviceWorkerUpdate.ts
        // sends SKIP_WAITING at a quiet moment. Until then the old worker keeps
        // serving this page's own files, so a chunk loaded late never 404s.
        // clientsClaim: once it takes over, it serves every open tab at once.
        clientsClaim: true,
        // Above workbox's 2 MiB default, so no big chunk silently drops out of
        // the precache (pages load on demand since 12.10.2026: src/app/pages.ts).
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Cache static assets indefinitely
        runtimeCaching: [
          {
            // The bundled Inter font files (fetched on demand by unicode-range).
            urlPattern: /\.woff2$/i,
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 12, maxAgeSeconds: 365 * 24 * 60 * 60 } },
          },
          {
            urlPattern: /^https:\/\/image\.tmdb\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tmdb-images',
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 },
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
