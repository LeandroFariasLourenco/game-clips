import { cleanupOutdatedCaches, createHandlerBoundToURL, getCacheKeyForURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import {
  CACHE_MEDIA_MESSAGE,
  CLEAR_MEDIA_CACHE_MESSAGE,
  MEDIA_CACHE_NAME,
} from './config/mediaConfig';
import { isMediaAssetUrl } from './services/mediaAssetUrl';

interface MediaWorkerEvent {
  data?: unknown;
  ports: MessagePort[];
  waitUntil: (promise: Promise<unknown>) => void;
}

interface MediaWorkerScope {
  skipWaiting: () => Promise<void>;
  clients: { claim: () => Promise<void> };
  addEventListener: (
    type: 'install' | 'activate' | 'message',
    listener: (event: MediaWorkerEvent) => void,
  ) => void;
}

const sw = self as unknown as MediaWorkerScope;

const MEDIA_CONCURRENCY = 4;

let cacheGeneration = 0;
let activeWarms = 0;
let warmIdle: Promise<void> = Promise.resolve();
let markWarmIdle = () => {};

// vite-plugin-pwa replaces self.__WB_MANIFEST in this call.
// @ts-expect-error Injection point is not part of the window type.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const indexUrl = `${import.meta.env.BASE_URL}index.html`;
try {
  if (getCacheKeyForURL(indexUrl)) {
    registerRoute(
      new NavigationRoute(createHandlerBoundToURL(indexUrl), {
        denylist: [/^\/__s3\//],
      }),
    );
  }
} catch {
  // Media caching still runs when the precached shell URL is unavailable.
}

function isVideoFileUrl(href: string): boolean {
  try {
    return /\.(mp4|webm|mkv|mov|avi)$/i.test(decodeURIComponent(new URL(href).pathname));
  } catch {
    return false;
  }
}

registerRoute(
  ({ request, url }) =>
    request.method === 'GET' &&
    !request.headers.has('range') &&
    !isVideoFileUrl(url.href) &&
    isMediaAssetUrl(url.href),
  ({ request }) => cacheFirstMedia(request),
);

sw.addEventListener('install', (event) => {
  event.waitUntil(sw.skipWaiting());
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(sw.clients.claim());
});

sw.addEventListener('message', (event) => {
  const data = event.data as { type?: string; urls?: unknown } | null;
  const port = event.ports[0];
  if (!data || typeof data.type !== 'string') return;

  if (data.type === 'SKIP_WAITING') {
    void sw.skipWaiting();
    return;
  }

  if (data.type === CLEAR_MEDIA_CACHE_MESSAGE) {
    cacheGeneration += 1;
    const idle = warmIdle;
    event.waitUntil(
      idle
        .then(() => caches.delete(MEDIA_CACHE_NAME))
        .then(() => {
          port?.postMessage({ ok: true });
        }),
    );
    return;
  }

  if (data.type === CACHE_MEDIA_MESSAGE && Array.isArray(data.urls)) {
    const generation = cacheGeneration;
    const urls = data.urls.filter((url): url is string => typeof url === 'string');
    const tracked = trackWarm(warmMediaUrls(urls, generation));
    event.waitUntil(
      tracked.then(() => {
        port?.postMessage({ ok: true });
      }),
    );
  }
});

function trackWarm(task: Promise<void>): Promise<void> {
  if (activeWarms === 0) {
    warmIdle = new Promise((resolve) => {
      markWarmIdle = resolve;
    });
  }
  activeWarms += 1;
  return task.finally(() => {
    activeWarms -= 1;
    if (activeWarms === 0) markWarmIdle();
  });
}

async function cacheFirstMedia(request: Request, generation: number | null = null): Promise<Response> {
  const cache = await caches.open(MEDIA_CACHE_NAME);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  if (generation !== null && generation !== cacheGeneration) {
    return fetch(request);
  }

  try {
    const response = await fetch(request.url, { mode: 'cors', credentials: 'omit' });
    if (response.ok && response.status !== 206 && (generation === null || generation === cacheGeneration)) {
      await cache.put(request.url, response.clone());
    }
    return response;
  } catch {
    return fetch(request);
  }
}

async function warmMediaUrls(urls: string[], generation: number): Promise<void> {
  const queue = [...new Set(urls.filter((url) => isMediaAssetUrl(url)))];
  if (queue.length === 0) return;

  let index = 0;
  const workers = Array.from({ length: Math.min(MEDIA_CONCURRENCY, queue.length) }, async () => {
    while (index < queue.length && generation === cacheGeneration) {
      const url = queue[index];
      index += 1;
      try {
        await cacheFirstMedia(new Request(url), generation);
      } catch {
        // A missing cover should not stop the rest of the library.
      }
    }
  });

  await Promise.all(workers);
}
