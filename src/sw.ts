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
const LIVE_MEDIA = new Set(['video', 'audio', 'track']);

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

function isRangeRequest(request: Request): boolean {
  return request.headers.has('range') || request.headers.has('Range');
}

/**
 * Cache images (covers, screenshots, thumbs). Never intercept video/audio or
 * Range requests — Firefox reports NS_ERROR_INTERCEPTED when those are claimed
 * and then aborted by the player.
 */
function shouldHandleMediaFetch(request: Request, href: string): boolean {
  if (request.method !== 'GET') return false;
  if (LIVE_MEDIA.has(request.destination)) return false;
  if (isRangeRequest(request) || isVideoFileUrl(href)) return false;
  return isMediaAssetUrl(href);
}

registerRoute(({ request, url }) => shouldHandleMediaFetch(request, url.href), ({ request }) =>
  cacheFirstMedia(request),
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

function canStoreMediaResponse(response: Response): boolean {
  if (response.type === 'error') return false;
  if (response.type === 'opaque') return true;
  return response.ok && response.status === 200;
}

async function cacheFirstMedia(request: Request, generation: number | null = null): Promise<Response> {
  const cache = await caches.open(MEDIA_CACHE_NAME);
  const cached = await cache.match(request.url);
  if (cached && (cached.ok || cached.type === 'opaque')) return cached;
  if (generation !== null && generation !== cacheGeneration) {
    return fetch(request);
  }

  try {
    const response = await fetch(request);
    if (canStoreMediaResponse(response) && (generation === null || generation === cacheGeneration)) {
      await cache.put(request.url, response.clone());
    }
    return response;
  } catch (error) {
    const fallback = await cache.match(request.url);
    if (fallback && (fallback.ok || fallback.type === 'opaque')) return fallback;
    throw error;
  }
}

async function warmMediaUrls(urls: string[], generation: number): Promise<void> {
  const queue = [...new Set(urls.filter((url) => isMediaAssetUrl(url) && !isVideoFileUrl(url)))];
  if (queue.length === 0) return;

  let index = 0;
  const workers = Array.from({ length: Math.min(MEDIA_CONCURRENCY, queue.length) }, async () => {
    while (index < queue.length && generation === cacheGeneration) {
      const url = queue[index];
      index += 1;
      try {
        await cacheFirstMedia(new Request(url, { mode: 'cors', credentials: 'omit' }), generation);
      } catch {
        // A missing cover should not stop the rest of the library.
      }
    }
  });

  await Promise.all(workers);
}
