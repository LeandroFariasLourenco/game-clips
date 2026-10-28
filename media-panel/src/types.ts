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
}

export interface GameDetails {
  name: string;
  coverUrl: string;
  bannerUrl: string;
  iconUrl: string;
  hasCover: boolean;
  hasBanner: boolean;
  hasIcon: boolean;
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
