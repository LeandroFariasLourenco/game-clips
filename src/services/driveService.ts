import { Game, GameMedia, MediaType } from '../types/game';
import { parseMasterJsonToGames } from '../utils/storageFormat';
import {
  GAMES_MANIFEST_FILE,
  buildMediaFileUrl,
  getGamesManifestUrl,
  getMediaBaseUrl,
  getMediaLibraryLabel,
} from '../config/mediaConfig';
import { clearGamesCache, readCachedText, storeCachedResponse } from './gamesCache';
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
