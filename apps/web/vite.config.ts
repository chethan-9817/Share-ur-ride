import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const API = process.env.VITE_API_PROXY ?? 'http://localhost:4000';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    host: true, // reachable from a phone on the same Wi-Fi
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/socket.io': { target: API, ws: true, changeOrigin: true },
      '/docs': { target: API, changeOrigin: true },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.svg'],
      manifest: {
        name: 'ArriveShare — safe ride-pooling',
        short_name: 'ArriveShare',
        description: 'Share a cab from the airport or station. Pay less, travel safer.',
        theme_color: '#4f46e5',
        background_color: '#0b0b14',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/, /^\/docs/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[abcd]\.basemaps\.cartocdn\.com\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 400, maxAgeSeconds: 7 * 24 * 3600 } },
          },
          {
            urlPattern: /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'satellite-tiles', expiration: { maxEntries: 600, maxAgeSeconds: 7 * 24 * 3600 } },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          map: ['leaflet', 'react-leaflet'],
          data: ['@tanstack/react-query', 'zustand', 'socket.io-client'],
        },
      },
    },
  },
});
