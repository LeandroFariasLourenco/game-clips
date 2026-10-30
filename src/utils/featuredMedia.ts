import { sanitizeVideoSrc, toPublicAssetUrl } from '../config/mediaConfig';
import { Game, GameMedia } from '../types/game';
import { fileNameFromUrl, shuffleInPlace } from './featuredRotation';
import { parseMediaCapturedAt } from './mediaSort';

export const FEATURED_MEDIA_LIMIT = 2;

export interface GameMetadataVideo {
  url: string;
  thumb: string;
}

export interface GameMetadata {
  images: string[];
  videos: GameMetadataVideo[];
}

export interface FeaturedHighlight {
  gameId: string;
  gameName: string;
  gameIcon?: string;
  media: GameMedia;
}

export function parseGameMetadata(raw: string): GameMetadata | null {
  try {
    const data = JSON.parse(raw) as Partial<GameMetadata>;
    if (!data || !Array.isArray(data.images) || !Array.isArray(data.videos)) return null;
    return {
      images: data.images.filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
      videos: data.videos.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const record = item as { url?: unknown; thumb?: unknown };
        if (typeof record.url !== 'string' || record.url.trim().length === 0) return [];
        return [{ url: record.url, thumb: typeof record.thumb === 'string' ? record.thumb : '' }];
      }),
    };
  } catch {
    return null;
  }
}

export function featuredMediaRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  let value = state >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function takeRandom<T>(items: T[], limit: number, keyOf: (item: T) => string, random: () => number): T[] {
  const unique: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return shuffleInPlace([...unique], random).slice(0, Math.max(0, limit));
}

function mimeFromName(name: string, kind: 'image' | 'video'): string {
  const lower = name.toLowerCase();
  if (kind === 'video') return lower.endsWith('.webm') ? 'video/webm' : 'video/mp4';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function capturedTime(name: string): string | undefined {
  return parseMediaCapturedAt(name)?.toISOString();
}

function imageMedia(game: Game, url: string): GameMedia {
  const src = toPublicAssetUrl(url);
  const name = fileNameFromUrl(src);
  return {
    id: `image-${game.id}-${name}`,
    gameId: game.id,
    name,
    type: 'screenshot',
    mimeType: mimeFromName(name, 'image'),
    size: 0,
    url: src,
    thumbnailUrl: src,
    createdTime: capturedTime(name),
  };
}

function videoMedia(game: Game, clip: GameMetadataVideo): GameMedia {
  const url = toPublicAssetUrl(sanitizeVideoSrc(clip.url));
  const name = fileNameFromUrl(url);
  return {
    id: `video-${game.id}-${name}`,
    gameId: game.id,
    name,
    type: 'video',
    mimeType: mimeFromName(name, 'video'),
    size: 0,
    url,
    thumbnailUrl: clip.thumb ? toPublicAssetUrl(sanitizeVideoSrc(clip.thumb)) : undefined,
    createdTime: capturedTime(name),
  };
}

function mixKinds(images: GameMedia[], videos: GameMedia[]): GameMedia[] {
  const mixed: GameMedia[] = [];
  const slots = Math.max(images.length, videos.length);
  for (let index = 0; index < slots; index += 1) {
    if (videos[index]) mixed.push(videos[index]);
    if (images[index]) mixed.push(images[index]);
  }
  return mixed;
}

export function allMediaFromMetadata(game: Game, metadata: GameMetadata): GameMedia[] {
  return [
    ...metadata.images.map((url) => imageMedia(game, url)),
    ...metadata.videos.map((clip) => videoMedia(game, clip)),
  ];
}

export function pickGameFeaturedMedia(
  game: Game,
  metadata: GameMetadata,
  random: () => number = Math.random,
  limit = FEATURED_MEDIA_LIMIT,
): GameMedia[] {
  const images = takeRandom(metadata.images, limit, (url) => url, random).map((url) => imageMedia(game, url));
  const videos = takeRandom(metadata.videos, limit, (clip) => clip.url, random).map((clip) =>
    videoMedia(game, clip),
  );
  return mixKinds(images, videos);
}

export function zipFeaturedHighlights(groups: FeaturedHighlight[][]): FeaturedHighlight[] {
  const mixed: FeaturedHighlight[] = [];
  const slots = groups.reduce((count, group) => Math.max(count, group.length), 0);
  for (let index = 0; index < slots; index += 1) {
    for (const group of groups) {
      const item = group[index];
      if (item) mixed.push(item);
    }
  }
  return mixed;
}
