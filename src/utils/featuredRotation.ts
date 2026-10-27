export const FEATURED_STORAGE_KEY = 'game-vault:featured-rotation-v2';
export const FEATURED_COUNT = 8;
export const FEATURED_ROTATION_MS = 7 * 24 * 60 * 60 * 1000;

const BRANDING_ASSET_RE = /^(cover|banner|icon|logo|hero)([._-].*)?$/i;

export type FeaturedMediaType = 'image' | 'video';

export interface FeaturedItem {
  gameId: string;
  gameName: string;
  type: FeaturedMediaType;
  url: string;
}

export interface FeaturedRotation {
  startedAt: number;
  expiresAt: number;
  items: FeaturedItem[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function fileNameFromUrl(pathOrUrl: string): string {
  const cleaned = pathOrUrl.split('?')[0];
  const parts = cleaned.split('/');
  return decodeURIComponent(parts[parts.length - 1] || '');
}

export function isBrandingAsset(pathOrUrl: string): boolean {
  const fileName = fileNameFromUrl(pathOrUrl);
  const baseName = fileName.replace(/\.[^.]+$/, '');
  return BRANDING_ASSET_RE.test(baseName);
}

export function isFeaturedMediaCandidate(item: FeaturedItem): boolean {
  if (item.type !== 'image' && item.type !== 'video') return false;
  return !isBrandingAsset(item.url);
}

export function isRotationValid(
  rotation: FeaturedRotation | null | undefined,
  now = Date.now()
): rotation is FeaturedRotation {
  if (!rotation || !Array.isArray(rotation.items) || rotation.items.length === 0) {
    return false;
  }
  if (typeof rotation.startedAt !== 'number' || typeof rotation.expiresAt !== 'number') {
    return false;
  }
  if (now >= rotation.expiresAt) return false;
  return rotation.items.every((item) => isFeaturedMediaCandidate(item));
}

export function remainingMs(rotation: FeaturedRotation, now = Date.now()): number {
  return Math.max(0, rotation.expiresAt - now);
}

export function formatRemaining(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function shuffleInPlace<T>(items: T[], random: () => number = Math.random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const current = items[i];
    items[i] = items[j];
    items[j] = current;
  }
  return items;
}

export function pickFeaturedItems(
  candidates: FeaturedItem[],
  count = FEATURED_COUNT,
  random: () => number = Math.random
): FeaturedItem[] {
  const unique: FeaturedItem[] = [];
  const seenUrls = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.url || seenUrls.has(candidate.url)) continue;
    seenUrls.add(candidate.url);
    unique.push(candidate);
  }

  const mediaOnly = unique.filter((item) => isFeaturedMediaCandidate(item));
  const shuffled = shuffleInPlace([...mediaOnly], random);
  const picked: FeaturedItem[] = [];
  const usedGames = new Set<string>();

  for (const item of shuffled) {
    if (picked.length >= count) break;
    if (usedGames.has(item.gameId)) continue;
    picked.push(item);
    usedGames.add(item.gameId);
  }

  for (const item of shuffled) {
    if (picked.length >= count) break;
    if (picked.includes(item)) continue;
    picked.push(item);
  }

  return picked;
}

export function createRotation(
  items: FeaturedItem[],
  now = Date.now(),
  durationMs = FEATURED_ROTATION_MS
): FeaturedRotation {
  return {
    startedAt: now,
    expiresAt: now + durationMs,
    items: items.slice(0, FEATURED_COUNT),
  };
}

export function readRotation(storage: StorageLike): FeaturedRotation | null {
  try {
    const raw = storage.getItem(FEATURED_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FeaturedRotation;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeRotation(rotation: FeaturedRotation, storage: StorageLike): void {
  storage.setItem(FEATURED_STORAGE_KEY, JSON.stringify(rotation));
}

export function getOrCreateRotation(
  candidates: FeaturedItem[],
  storage: StorageLike,
  now = Date.now(),
  random: () => number = Math.random
): FeaturedRotation {
  const existing = readRotation(storage);
  if (isRotationValid(existing, now)) {
    return existing;
  }

  const items = pickFeaturedItems(candidates, FEATURED_COUNT, random);
  const rotation = createRotation(items, now);
  writeRotation(rotation, storage);
  return rotation;
}
