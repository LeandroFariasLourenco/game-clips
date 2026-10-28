export type UploadKind = "cover" | "banner" | "icon" | "image" | "video";

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
