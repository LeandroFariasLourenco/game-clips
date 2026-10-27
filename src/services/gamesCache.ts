import { GAMES_CACHE_NAME } from '../config/mediaConfig';

export async function readCachedText(url: string): Promise<string | null> {
  if (!('caches' in globalThis)) return null;
  const cache = await caches.open(GAMES_CACHE_NAME);
  const match = await cache.match(url);
  if (!match) return null;
  return match.text();
}

export async function storeCachedResponse(url: string, response: Response): Promise<void> {
  if (!('caches' in globalThis) || !response.ok) return;
  const cache = await caches.open(GAMES_CACHE_NAME);
  await cache.put(url, response.clone());
}

export async function clearGamesCache(): Promise<void> {
  if (!('caches' in globalThis)) return;
  await caches.delete(GAMES_CACHE_NAME);
}
