import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type ProxyOptions } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const DEFAULT_MEDIA_BUCKET_URL =
  'https://game-clips-assets-306702688592-us-east-1-an.s3.us-east-1.amazonaws.com';
const DEV_MEDIA_PROXY_PREFIX = '/__s3';

const mediaBucketProxy: Record<string, ProxyOptions> = {
  [DEV_MEDIA_PROXY_PREFIX]: {
    target: DEFAULT_MEDIA_BUCKET_URL,
    changeOrigin: true,
    rewrite: (requestPath) => requestPath.replace(new RegExp(`^${DEV_MEDIA_PROXY_PREFIX}`), '') || '/',
  },
};

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icon.svg'],
        manifest: {
          id: '/',
          name: 'Biblioteca de Jogos',
          short_name: 'Jogos',
          description: 'PWA para gerenciamento e mídias de jogos.',
          theme_color: '#121212',
          background_color: '#121212',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/game-clips-worker\.feleolive2010\.workers\.dev\/?$/i,
              handler: 'NetworkOnly',
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: mediaBucketProxy,
    },
    preview: {
      proxy: mediaBucketProxy,
    },
  };
});
