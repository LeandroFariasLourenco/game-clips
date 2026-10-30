export const DEFAULT_MEDIA_BUCKET_URL =
  'https://game-clips-assets-306702688592-us-east-1-an.s3.us-east-1.amazonaws.com';

export const DEFAULT_MEDIA_WORKER_URL = 'https://game-clips-worker.feleolive2010.workers.dev';

export const GAMES_MANIFEST_FILE = 'games.json';
export const GAME_METADATA_FILE = 'metadata.json';
export const GAMES_CACHE_NAME = 'game-vault-games';
export const MEDIA_CACHE_NAME = 'game-vault-media';
export const CACHE_MEDIA_MESSAGE = 'CACHE_MEDIA';
export const CLEAR_MEDIA_CACHE_MESSAGE = 'CLEAR_MEDIA_CACHE';
export const DEV_MEDIA_PROXY_PREFIX = '/__s3';

export type GameBrandingAssetType = 'cover' | 'banner' | 'icon';

/** Canonical branding files in each bucket folder. Do not add extra formats. */
export const GAME_BRANDING_ASSETS: Record<GameBrandingAssetType, string> = {
  cover: 'cover.jpg',
  banner: 'banner.jpg',
  icon: 'icon.png',
};

export function matchBrandingAsset(fileName: string): GameBrandingAssetType | null {
  const lower = fileName.toLowerCase();
  if (lower === GAME_BRANDING_ASSETS.cover) return 'cover';
  if (lower === GAME_BRANDING_ASSETS.banner) return 'banner';
  if (lower === GAME_BRANDING_ASSETS.icon) return 'icon';
  return null;
}

export function normalizeBucketUrl(raw?: string | null): string {
  if (!raw) return '';
  return raw.trim().replace(/\/+$/, '');
}

export function resolveMediaBaseUrl(bucketUrl?: string | null): string {
  return normalizeBucketUrl(bucketUrl) || DEFAULT_MEDIA_BUCKET_URL;
}

export function encodeMediaPath(segments: string[]): string {
  return segments
    .flatMap((segment) => segment.split('/'))
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function buildMediaFileUrl(base: string, folderName: string, relativeFilePath: string): string {
  const path = encodeMediaPath([folderName, relativeFilePath]);
  return `${normalizeBucketUrl(base)}/${path}`;
}

export function gamesManifestUrl(base: string, options?: { dev?: boolean }): string {
  if (options?.dev) {
    return `${DEV_MEDIA_PROXY_PREFIX}/${GAMES_MANIFEST_FILE}`;
  }
  return `${normalizeBucketUrl(base)}/${GAMES_MANIFEST_FILE}`;
}

export function resolveMediaWorkerUrl(workerUrl?: string | null): string {
  return normalizeBucketUrl(workerUrl) || DEFAULT_MEDIA_WORKER_URL;
}

export function gamesCatalogUrl(workerUrl?: string | null): string {
  return resolveMediaWorkerUrl(workerUrl);
}

function readRuntimeBucketUrl(): string {
  return resolveMediaBaseUrl(import.meta.env.VITE_MEDIA_BUCKET_URL as string | undefined);
}

function readRuntimeWorkerUrl(): string {
  return resolveMediaWorkerUrl(import.meta.env.VITE_MEDIA_WORKER_URL as string | undefined);
}

export function getMediaBaseUrl(): string {
  return readRuntimeBucketUrl();
}

export function getMediaWorkerUrl(): string {
  return readRuntimeWorkerUrl();
}

export function getGamesManifestUrl(): string {
  return gamesCatalogUrl(readRuntimeWorkerUrl());
}

export function gameImagesUrl(workerUrl: string, folderName: string): string {
  return `${resolveMediaWorkerUrl(workerUrl)}/${encodeMediaPath([folderName, 'images'])}`;
}

export function getGameImagesUrl(folderName: string): string {
  return gameImagesUrl(readRuntimeWorkerUrl(), folderName);
}

export const VIDEO_THUMB_FILE = 'thumb.jpg';
const VIDEO_FILE_RE = /\.(mp4|webm|mkv|mov|avi)$/i;

export function videoFileNameFromUrl(pathOrUrl: string): string {
  try {
    return decodeURIComponent(new URL(pathOrUrl).pathname.split('/').pop() || '');
  } catch {
    return decodeURIComponent(pathOrUrl.split('?')[0].split('/').pop() || '');
  }
}

/** Clip filenames use `Jogo#n`; a raw `#` would be treated as a URL hash and break playback. */
export function sanitizeVideoSrc(raw: string): string {
  if (!raw) return raw;
  const href = /#t=/i.test(raw) ? raw : raw.replace(/#/g, '%23');
  try {
    const url = new URL(href);
    url.pathname = url.pathname
      .split('/')
      .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
      .join('/');
    return url.href;
  } catch {
    return href;
  }
}

/** Clip mp4 lives beside thumb.jpg: videos/<clip>/<clip>.mp4 */
export function videoUrlBesideThumb(
  videoUrl: string,
  thumbnailUrl?: string,
  fileName?: string,
): string {
  if (!thumbnailUrl) return sanitizeVideoSrc(videoUrl);

  try {
    const thumb = new URL(thumbnailUrl);
    const segments = thumb.pathname.split('/').filter(Boolean);
    const thumbName = decodeURIComponent(segments[segments.length - 1] || '');
    if (thumbName.toLowerCase() !== VIDEO_THUMB_FILE || segments.length < 2) {
      return sanitizeVideoSrc(videoUrl);
    }

    const folder = decodeURIComponent(segments[segments.length - 2] || '');
    const listed = fileName && VIDEO_FILE_RE.test(fileName) ? fileName : '';
    const fromVideo = videoFileNameFromUrl(videoUrl);
    const playbackName =
      listed || (VIDEO_FILE_RE.test(fromVideo) ? fromVideo : '') || (folder ? `${folder}.mp4` : '');
    if (!playbackName) return sanitizeVideoSrc(videoUrl);

    segments[segments.length - 1] = encodeURIComponent(playbackName);
    thumb.pathname = `/${segments.join('/')}`;
    return sanitizeVideoSrc(thumb.toString());
  } catch {
    return sanitizeVideoSrc(videoUrl);
  }
}

export function gameVideosUrl(workerUrl: string, folderName: string): string {
  return `${resolveMediaWorkerUrl(workerUrl)}/${encodeMediaPath([folderName, 'videos'])}`;
}

export function getGameVideosUrl(folderName: string): string {
  return gameVideosUrl(readRuntimeWorkerUrl(), folderName);
}

export function gameMetadataUrl(base: string, folderName: string): string {
  return `${normalizeBucketUrl(base)}/${encodeMediaPath([folderName, GAME_METADATA_FILE])}`;
}

/** Dev reads the bucket through the Vite proxy. Production uses the worker, which adds CORS. */
export function getGameMetadataUrl(folderName: string): string {
  const path = encodeMediaPath([folderName, GAME_METADATA_FILE]);
  if (import.meta.env?.DEV) {
    return `${DEV_MEDIA_PROXY_PREFIX}/${path}`;
  }
  return `${readRuntimeWorkerUrl()}/${path}`;
}

export function getMediaLibraryLabel(): string {
  return 'bucket';
}
