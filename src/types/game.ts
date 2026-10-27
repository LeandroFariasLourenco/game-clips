export interface Game {
  id: string; // unique ID, e.g. steam-730 or slug
  name: string;
  steamAppId?: string; // numeric Steam ID or undefined
  playTimeMinutes: number; // in minutes
  lastPlayed?: string; // ISO date string
  genre?: string;
  developer?: string;
  releaseYear?: number;
  subfolderName: string; // folder name inside Biblioteca_de_Jogos
  cover?: string; // URL absoluta da capa (resposta do worker)
  customCoverUrl?: string; // override cover if available
  customBannerUrl?: string; // override banner if available
  favorite?: boolean;
}

export type MediaType = 'screenshot' | 'video' | 'backup' | 'artwork';

export interface GameMedia {
  id: string;
  gameId: string;
  name: string; // e.g. "boss_fight.mp4", "ending_screen.png"
  type: MediaType;
  mimeType: string;
  size: number;
  url: string; // Local file URL or Blob URL
  thumbnailUrl?: string;
  createdTime?: string;
}

export interface UserSession {
  email: string;
  displayName: string;
  photoURL?: string;
  uid: string;
  isOwner: boolean;
}
