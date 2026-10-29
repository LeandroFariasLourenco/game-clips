export type UploadKind = "cover" | "banner" | "icon" | "image" | "video";
export type SteamGridKind = "cover" | "banner" | "icon";

export interface SteamGridGameMatch {
  id: number;
  name: string;
  verified: boolean;
}

export interface SteamGridImage {
  id: number;
  url: string;
  thumb: string;
  width: number;
  height: number;
  score: number;
}

export interface GameSummary {
  name: string;
  coverUrl: string;
}

export interface MediaFile {
  name: string;
  key: string;
  url: string;
  size: number;
  insertedAt?: string;
  modifiedAt?: string;
  inMetadata?: boolean;
}

export interface GameMetadataVideo {
  url: string;
  thumb: string;
}

export interface GameMetadata {
  images: string[];
  videos: GameMetadataVideo[];
}

export interface GameMetadataResult {
  key: string;
  url: string;
  images: number;
  videos: number;
}

export interface GameDetails {
  name: string;
  coverUrl: string;
  bannerUrl: string;
  iconUrl: string;
  hasCover: boolean;
  hasBanner: boolean;
  hasIcon: boolean;
  hasMetadata?: boolean;
  images: MediaFile[];
  videos: MediaFile[];
  fromCache?: boolean;
  cachedAt?: string;
}

export interface GamesCatalog {
  games: GameSummary[];
  fromCache: boolean;
  cachedAt: string | null;
}

export interface LocalGameSummary {
  name: string;
  hasCover: boolean;
  hasBanner: boolean;
  hasIcon: boolean;
  images: number;
  videos: number;
  looseVideos: number;
  thumbs: number;
  missingThumbs: number;
  hasMetadata: boolean;
  other: number;
  bytes: number;
}

export interface LocalMediaInventory {
  root: string;
  exists: boolean;
  hasManifest: boolean;
  scannedAt: string;
  destination: { bucket: string; region: string; uri: string } | null;
  destinationError: string | null;
  totals: {
    games: number;
    files: number;
    bytes: number;
    covers: number;
    banners: number;
    icons: number;
    images: number;
    videos: number;
    looseVideos: number;
    thumbs: number;
    missingThumbs: number;
    metadata: number;
    other: number;
  };
  otherSamples: string[];
  games: LocalGameSummary[];
}

export interface LocalSyncStatus {
  status: "idle" | "running" | "success" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  command: string | null;
  log: string[];
}
