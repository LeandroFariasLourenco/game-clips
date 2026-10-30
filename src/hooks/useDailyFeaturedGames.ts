import { useEffect, useMemo, useState } from 'react';
import { Game } from '../types/game';
import {
  getOrCreateDailyFeaturedGames,
  localDateKey,
  msUntilNextDailyFeatured,
  pickDailyFeaturedGames,
} from '../utils/dailyFeaturedGames';

export function useDailyFeaturedGames(games: Game[]): {
  featured: Game[];
  remainingMs: number;
} {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const dateKey = localDateKey(new Date(nowMs));

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const featured = useMemo(() => {
    if (games.length === 0) return [];
    try {
      if (typeof localStorage === 'undefined') {
        return pickDailyFeaturedGames(games);
      }
      return getOrCreateDailyFeaturedGames(games, localStorage);
    } catch {
      return pickDailyFeaturedGames(games);
    }
  }, [games, dateKey]);

  return {
    featured,
    remainingMs: msUntilNextDailyFeatured(new Date(nowMs)),
  };
}
