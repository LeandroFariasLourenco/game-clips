import { useMemo } from 'react';
import { Game } from '../types/game';
import { getOrCreateDailyFeaturedGames, pickDailyFeaturedGames } from '../utils/dailyFeaturedGames';

export function useDailyFeaturedGames(games: Game[]): Game[] {
  return useMemo(() => {
    if (games.length === 0) return [];
    if (typeof localStorage === 'undefined') {
      return pickDailyFeaturedGames(games);
    }
    return getOrCreateDailyFeaturedGames(games, localStorage);
  }, [games]);
}
