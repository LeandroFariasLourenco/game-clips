export const DEFAULT_MEDIA_BUCKET_URL =
  'https://game-clips-assets-306702688592-us-east-1-an.s3.us-east-1.amazonaws.com';

export const DEFAULT_MEDIA_WORKER_URL = 'https://game-clips-worker.feleolive2010.workers.dev';

export const GAMES_MANIFEST_FILE = 'games.json';
export const GAMES_CACHE_NAME = 'game-vault-games';
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

export function getMediaLibraryLabel(): string {
  return 'bucket';
}
