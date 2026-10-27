import { createContext, useContext } from 'react';
import { Game } from './types/game';

export interface LibraryOutletContext {
  games: Game[];
  filteredGames: Game[];
  searchQuery: string;
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

export function gameDetailsPath(gameId: string): string {
  return `/game/${encodeURIComponent(gameId)}`;
}

export function gameDetailsCacheKey(game: Game): string {
  return game.name;
}

export function resolveRouteCacheKey(
  pathname: string,
  gameId: string | undefined,
  games: Game[]
): string | null {
  if (pathname === '/' || pathname === '') return HOME_CACHE_KEY;
  if (!gameId) return null;
  const decodedId = decodeURIComponent(gameId);
  const game = games.find((item) => item.id === decodedId);
  return game ? gameDetailsCacheKey(game) : null;
}
