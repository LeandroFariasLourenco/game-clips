import { Game, GameMedia, MediaType } from '../types/game';
import { parseMasterJsonToGames } from '../utils/storageFormat';
import {
  GAMES_MANIFEST_FILE,
  buildMediaFileUrl,
  getGameImagesUrl,
  getGameVideosUrl,
  getGamesManifestUrl,
  getMediaBaseUrl,
  getMediaLibraryLabel,
} from '../config/mediaConfig';
import { clearGamesCache, readCachedText, storeCachedResponse } from './gamesCache';
import { clearMediaCache } from './mediaCache';
import { FEATURED_STORAGE_KEY } from '../utils/featuredRotation';

export const MASTER_FILE_NAME = GAMES_MANIFEST_FILE;

export function getLocalBaseFolderName(): string {
  return getMediaLibraryLabel();
}

export function getGameFolderName(game: Game): string {
  if (game.subfolderName) {
    return game.subfolderName;
  }
  return game.name.replace(/[\\/*?:"<>|]/g, '').trim();
}

export function buildLocalMediaUrl(folderName: string, relativeFilePath: string): string {
  return buildMediaFileUrl(getMediaBaseUrl(), folderName, relativeFilePath);
}

export interface WorkerListedFile {
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
  createdTime?: string;
  url: string;
  thumbnailUrl?: string;
}

export function mapListedImagesToMedia(game: Game, files: WorkerListedFile[]): GameMedia[] {
  return files.map((file) => ({
    id: `image-${game.id}-${file.relativePath}`,
    gameId: game.id,
    name: file.name,
    type: 'screenshot',
    mimeType: file.mimeType || 'image/jpeg',
    size: Number(file.size || 0),
    url: file.url,
    thumbnailUrl: file.url,
    createdTime: file.createdTime,
  }));
}

export function mapListedVideosToMedia(game: Game, files: WorkerListedFile[]): GameMedia[] {
  return files.map((file) => ({
    id: `video-${game.id}-${file.relativePath}`,
    gameId: game.id,
    name: file.name,
    type: 'video',
    mimeType: file.mimeType || 'video/mp4',
    size: Number(file.size || 0),
    url: file.url,
    thumbnailUrl: file.thumbnailUrl,
    createdTime: file.createdTime,
  }));
}

class RemoteLibraryService {
  /**
   * Loads the game catalog from the Cloudflare Worker (`GET /` → `{ name, cover }[]`).
   * Cached indefinitely until the user explicitly reloads the library.
   */
  public async loadLocalGames(options?: {
    forceRefresh?: boolean;
  }): Promise<{ games: Game[]; source: 'cache' | 'network'; error?: string }> {
    const url = getGamesManifestUrl();

    try {
      if (options?.forceRefresh) {
        await clearGamesCache();
        await clearMediaCache();
        try {
          localStorage.removeItem(FEATURED_STORAGE_KEY);
        } catch {
          // ignore storage errors
        }
      } else {
        const cachedText = await readCachedText(url);
        if (cachedText) {
          return { games: parseMasterJsonToGames(cachedText), source: 'cache' };
        }
      }

      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        return {
          games: [],
          source: 'network',
          error: `Falha ao buscar catálogo no worker (${res.status})`,
        };
      }

      await storeCachedResponse(url, res);
      const jsonText = await res.text();
      const parsedGames = parseMasterJsonToGames(jsonText);
      return { games: parsedGames, source: 'network' };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('Falha ao carregar biblioteca no bucket:', err);
      return { games: [], source: 'network', error: errorMsg };
    }
  }

  public async listGameImages(game: Game): Promise<GameMedia[]> {
    const folderName = getGameFolderName(game);
    const res = await fetch(getGameImagesUrl(folderName), { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Falha ao listar imagens (${res.status})`);
    }

    const payload = (await res.json()) as { images?: WorkerListedFile[] };
    return mapListedImagesToMedia(game, payload.images || []);
  }

  public async listGameVideos(game: Game): Promise<GameMedia[]> {
    const folderName = getGameFolderName(game);
    const res = await fetch(getGameVideosUrl(folderName), { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Falha ao listar vídeos (${res.status})`);
    }

    const payload = (await res.json()) as { videos?: WorkerListedFile[] };
    return mapListedVideosToMedia(game, payload.videos || []);
  }

  public async saveMediaFile(game: Game, file: File): Promise<GameMedia> {
    let type: MediaType = 'screenshot';
    if (file.type.startsWith('video/') || /\.(mp4|webm|mkv|mov)$/i.test(file.name)) {
      type = 'video';
    } else if (/\.(zip|rar|7z|exe|iso)$/i.test(file.name)) {
      type = 'backup';
    }

    const localUrl = URL.createObjectURL(file);
    const newMedia: GameMedia = {
      id: `local-media-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      gameId: game.id,
      name: file.name,
      type,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      url: localUrl,
      thumbnailUrl: type === 'screenshot' ? localUrl : undefined,
      createdTime: new Date().toISOString(),
    };
    return newMedia;
  }
}

export const localLibraryService = new RemoteLibraryService();
