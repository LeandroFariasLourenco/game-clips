import { createContext, useContext } from 'react';
import { Game } from './types/game';

export interface LibraryOutletContext {
  games: Game[];
  filteredGames: Game[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isSyncing: boolean;
  onRefreshLocal: () => void;
}

export const LibraryContext = createContext<LibraryOutletContext | null>(null);

export function useLibrary(): LibraryOutletContext {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error('useLibrary must be used within LibraryContext.Provider');
  }
  return context;
}

export const HOME_CACHE_KEY = 'home';
export const REELS_CACHE_KEY = 'reels';
export const REELS_PATH = '/reels';

export function isPersistentRouteCacheKey(cacheKey: string): boolean {
  return cacheKey === HOME_CACHE_KEY || cacheKey === REELS_CACHE_KEY;
}

export function gameDetailsPath(gameName: string): string {
  return `/${encodeURIComponent(gameName)}`;
}

export function gameDetailsCacheKey(game: Game): string {
  return game.name;
}

export function findGameByName(games: Game[], gameName: string | undefined): Game | undefined {
  if (!gameName) return undefined;
  const decoded = decodeURIComponent(gameName).trim();
  if (!decoded) return undefined;
  const exact =
    games.find((item) => item.name === decoded) ||
    games.find((item) => item.subfolderName === decoded);
  if (exact) return exact;
  const lower = decoded.toLowerCase();
  return games.find(
    (item) => item.name.toLowerCase() === lower || item.subfolderName.toLowerCase() === lower
  );
}

export function resolveRouteCacheKey(
  pathname: string,
  gameName: string | undefined,
  games: Game[]
): string | null {
  if (pathname === '/' || pathname === '') return HOME_CACHE_KEY;
  if (pathname === REELS_PATH || pathname.endsWith(REELS_PATH)) return REELS_CACHE_KEY;
  const game = findGameByName(games, gameName);
  return game ? gameDetailsCacheKey(game) : null;
}
