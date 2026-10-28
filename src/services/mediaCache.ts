import {
  CACHE_MEDIA_MESSAGE,
  CLEAR_MEDIA_CACHE_MESSAGE,
  MEDIA_CACHE_NAME,
} from '../config/mediaConfig';
import { GameMedia } from '../types/game';
import { isMediaAssetUrl } from './mediaAssetUrl';

/** Screenshots (full image) plus video thumbs. Video files stay on the network (Range). */
export function collectGameMediaCacheUrls(items: GameMedia[]): string[] {
  const urls: string[] = [];
  for (const item of items) {
    if (item.type === 'video') {
      if (item.thumbnailUrl) urls.push(item.thumbnailUrl);
      continue;
    }
    if (item.url) urls.push(item.url);
    if (item.thumbnailUrl && item.thumbnailUrl !== item.url) urls.push(item.thumbnailUrl);
  }
  return urls;
}

type MediaCacheMessage =
  | { type: typeof CACHE_MEDIA_MESSAGE; urls: string[] }
  | { type: typeof CLEAR_MEDIA_CACHE_MESSAGE };

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

async function activeWorker(timeoutMs: number): Promise<ServiceWorker | null> {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await withTimeout<ServiceWorkerRegistration | null>(
    navigator.serviceWorker.ready,
    timeoutMs,
    null,
  );
  return registration?.active ?? null;
}

function postToWorker(worker: ServiceWorker, message: MediaCacheMessage, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(resolve, timeoutMs);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve();
    };
    worker.postMessage(message, [channel.port2]);
  });
}

export async function warmMediaCache(urls: string[]): Promise<void> {
  const unique = [...new Set(urls.filter((url) => isMediaAssetUrl(url)))];
  if (unique.length === 0) return;

  const worker = await activeWorker(8000);
  if (!worker) return;
  await postToWorker(worker, { type: CACHE_MEDIA_MESSAGE, urls: unique }, 120_000);
}

export async function clearMediaCache(): Promise<void> {
  const worker = await activeWorker(4000);
  if (worker) {
    await postToWorker(worker, { type: CLEAR_MEDIA_CACHE_MESSAGE }, 15000);
    return;
  }
  if ('caches' in globalThis) await caches.delete(MEDIA_CACHE_NAME);
}
