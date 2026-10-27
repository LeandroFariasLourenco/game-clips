import { Game } from '../types/game';

/**
 * Structure of the Flat File Database stored at:
 * Google Drive / Biblioteca_de_Jogos / games.json
 *
 * Strict requirement: ONLY lightweight metadata (Name, Steam AppID, Playtime).
 * No media paths!
 */
export interface MasterGamesFile {
  version: number;
  lastUpdated: string;
  games: MasterGameItem[];
}

export interface MasterGameItem {
  id: string;
  name: string;
  steamAppId?: string;
  playTimeMinutes: number;
  lastPlayed?: string;
  genre?: string;
  developer?: string;
  releaseYear?: number;
  subfolderName: string;
}

export function serializeGamesToMasterJson(games: Game[]): string {
  const masterPayload: MasterGamesFile = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    games: games.map((g) => ({
      id: g.id,
      name: g.name,
      steamAppId: g.steamAppId,
      playTimeMinutes: g.playTimeMinutes || 0,
      lastPlayed: g.lastPlayed,
      genre: g.genre,
      developer: g.developer,
      releaseYear: g.releaseYear,
      subfolderName: g.subfolderName,
    })),
  };
  return JSON.stringify(masterPayload, null, 2);
}

export function parseMasterJsonToGames(jsonContent: string): Game[] {
  try {
    // Strip possible UTF-8 BOM
    const cleanJson =
      jsonContent.charCodeAt(0) === 0xfeff ? jsonContent.slice(1) : jsonContent;
    const parsed = JSON.parse(cleanJson);
    // Support flat array or object with games/Games/data
    const list: any[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.games)
      ? parsed.games
      : Array.isArray(parsed.Games)
      ? parsed.Games
      : Array.isArray(parsed.data)
      ? parsed.data
      : [];

    return list.map((item: any) => {
      const name = item.name || item.Name || item.title || item.Title || 'Jogo Sem Nome';
      const rawSteamId =
        item.steamAppId ||
        item.SteamAppId ||
        item.appId ||
        item.AppId ||
        item.gameId ||
        item.GameId;
      const steamAppId = rawSteamId ? String(rawSteamId).trim() : undefined;

      const playTimeMinutes =
        typeof item.playTimeMinutes === 'number'
          ? item.playTimeMinutes
          : typeof item.PlayTimeMinutes === 'number'
          ? item.PlayTimeMinutes
          : typeof item.PlaytimeSeconds === 'number'
          ? Math.round(item.PlaytimeSeconds / 60)
          : typeof item.playtime === 'number'
          ? item.playtime
          : 0;

      const genre = Array.isArray(item.genres || item.Genres)
        ? (item.genres || item.Genres).join(', ')
        : item.genre || item.Genre;

      const developer = Array.isArray(item.developers || item.Developers)
        ? (item.developers || item.Developers).join(', ')
        : item.developer || item.Developer;

      const cleanFolderName = name.replace(/[\\/*?:"<>|]/g, '').trim();
      const subfolderName =
        item.subfolderName ||
        item.SubfolderName ||
        cleanFolderName;

      const slugId = cleanFolderName.toLowerCase().replace(/\s+/g, '-');

      const cover =
        typeof item.cover === 'string' && item.cover.trim()
          ? item.cover.trim()
          : undefined;

      return {
        id: item.id || (steamAppId ? `steam-${steamAppId}` : `game-${slugId}`),
        name,
        steamAppId,
        playTimeMinutes,
        lastPlayed: item.lastPlayed || item.LastPlayed,
        genre,
        developer,
        releaseYear: item.releaseYear || item.ReleaseYear,
        subfolderName,
        cover,
      };
    });
  } catch (err) {
    console.error('Erro ao ler catálogo de jogos:', err);
    throw new Error('Formato inválido do catálogo de jogos');
  }
}
