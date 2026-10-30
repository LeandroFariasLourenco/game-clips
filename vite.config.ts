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
  const base = process.env.VITE_BASE_PATH || '/';

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectRegister: 'inline',
        includeAssets: [
          'favicon.ico',
          'favicon-32x32.png',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: base,
          name: 'Game clips',
          short_name: 'Game clips',
          description: 'Catálogo e mídias da biblioteca de jogos, com acesso offline ao conteúdo em cache.',
          lang: 'pt-BR',
          dir: 'ltr',
          theme_color: '#121212',
          background_color: '#121212',
          display: 'standalone',
          display_override: ['standalone', 'minimal-ui', 'browser'],
          orientation: 'any',
          start_url: base,
          scope: base,
          prefer_related_applications: false,
          categories: ['entertainment', 'games'],
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          rollupFormat: 'iife',
        },
        devOptions: {
          enabled: true,
          type: 'module',
          navigateFallback: 'index.html',
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
