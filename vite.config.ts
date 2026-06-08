import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      base: '/Project_Daily/',
      scope: '/Project_Daily/',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: "Lasci's Board",
        short_name: 'Board',
        description: 'Personal dashboard — daily planning, tasks, media, training',
        theme_color: '#f97316',
        background_color: '#fffdf7',
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
      },
      workbox: {
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
