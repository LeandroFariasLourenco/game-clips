import { extname } from "node:path";

export const METADATA_FILE = "metadata.json";
export const DEFAULT_PUBLIC_ASSET_BASE_URL = "https://d3nyc65v53ljin.cloudfront.net";
export const VIDEO_THUMB_FILE = "thumb.jpg";
export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);
export const VIDEO_EXTENSION = ".mp4";

export interface GameMetadataVideo {
  url: string;
  thumb: string;
}

export interface GameMetadata {
  images: string[];
  videos: GameMetadataVideo[];
}

export interface GameMetadataListing {
  images: string[];
  videos: Array<{ folder: string; fileName: string }>;
}

export interface GameMetadataWriteResult {
  key: string;
  url: string;
  images: number;
  videos: number;
}

function encodePath(segments: string[]): string {
  return segments
    .flatMap((segment) => segment.split("/"))
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** Public CDN used in metadata.json URLs. Env wins so the distribution can change later. */
export function resolvePublicAssetBaseUrl(...candidates: Array<string | null | undefined>): string {
  for (const raw of candidates) {
    const value = raw?.trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
    if (value) return value;
  }
  return DEFAULT_PUBLIC_ASSET_BASE_URL;
}

export function mediaFileUrl(publicBaseUrl: string, game: string, relativePath: string): string {
  const base = resolvePublicAssetBaseUrl(publicBaseUrl);
  return `${base}/${encodePath([game, relativePath])}`;
}

export function metadataObjectKey(game: string): string {
  return `${game}/${METADATA_FILE}`;
}

export function isGalleryImage(fileName: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(fileName).toLowerCase());
}

export function isCanonicalVideo(fileName: string): boolean {
  return extname(fileName).toLowerCase() === VIDEO_EXTENSION;
}

export function listingFromObjectKeys(game: string, keys: string[]): GameMetadataListing {
  const prefix = `${game}/`;
  const images: string[] = [];
  const videos: Array<{ folder: string; fileName: string }> = [];

  for (const key of keys) {
    const relative = key.startsWith(prefix) ? key.slice(prefix.length) : key;
    const parts = relative.split("/").filter(Boolean);
    if (parts.length === 2 && parts[0] === "images" && isGalleryImage(parts[1])) {
      images.push(parts[1]);
      continue;
    }
    if (parts.length === 3 && parts[0] === "videos" && isCanonicalVideo(parts[2])) {
      videos.push({ folder: parts[1], fileName: parts[2] });
    }
  }

  images.sort((a, b) => a.localeCompare(b, "pt", { sensitivity: "base" }));
  videos.sort((a, b) => {
    const folder = a.folder.localeCompare(b.folder, "pt", { sensitivity: "base" });
    return folder !== 0 ? folder : a.fileName.localeCompare(b.fileName, "pt", { sensitivity: "base" });
  });

  return { images, videos };
}

export function buildGameMetadata(
  game: string,
  publicBaseUrl: string,
  listing: GameMetadataListing,
): GameMetadata {
  return {
    images: listing.images.map((name) => mediaFileUrl(publicBaseUrl, game, `images/${name}`)),
    videos: listing.videos.map((clip) => ({
      url: mediaFileUrl(publicBaseUrl, game, `videos/${clip.folder}/${clip.fileName}`),
      thumb: mediaFileUrl(publicBaseUrl, game, `videos/${clip.folder}/${VIDEO_THUMB_FILE}`),
    })),
  };
}

export function serializeGameMetadata(metadata: GameMetadata): string {
  return `${JSON.stringify(metadata, null, 2)}\n`;
}

export function kindUpdatesGameMetadata(kind: string): boolean {
  return kind === "image" || kind === "video";
}

export function normalizeMediaPath(urlOrKey: string): string {
  const raw = urlOrKey.trim();
  if (!raw) return "";
  let path = raw;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      path = new URL(raw).pathname;
    }
  } catch {
    path = raw;
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    // mantém o caminho original se a URL estiver malformada
  }
  return path.replace(/^\/+/, "");
}

export function parseGameMetadata(raw: string): GameMetadata | null {
  try {
    const data = JSON.parse(raw) as Partial<GameMetadata>;
    if (!Array.isArray(data.images) || !Array.isArray(data.videos)) return null;
    return {
      images: data.images.filter((item): item is string => typeof item === "string"),
      videos: data.videos.flatMap((item) => {
        if (!item || typeof item !== "object" || typeof item.url !== "string") return [];
        return [{ url: item.url, thumb: typeof item.thumb === "string" ? item.thumb : "" }];
      }),
    };
  } catch {
    return null;
  }
}

export function metadataMediaPaths(metadata: GameMetadata | null): {
  images: Set<string>;
  videos: Set<string>;
} {
  const images = new Set<string>();
  const videos = new Set<string>();
  if (!metadata) return { images, videos };
  for (const url of metadata.images) images.add(normalizeMediaPath(url));
  for (const clip of metadata.videos) videos.add(normalizeMediaPath(clip.url));
  return { images, videos };
}

export function isLinkedInMetadata(keyOrUrl: string, paths: Set<string>): boolean {
  const path = normalizeMediaPath(keyOrUrl);
  return Boolean(path) && paths.has(path);
}
