import { Game } from '../types/game';
import { shuffleInPlace, StorageLike } from './featuredRotation';

export const DAILY_FEATURED_COUNT = 3;
export const DAILY_FEATURED_STORAGE_KEY = 'game-vault:daily-featured-v1';

export interface DailyFeaturedRecord {
  date: string;
  gameIds: string[];
}

export function localDateKey(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function nextDailyFeaturedAt(now: Date = new Date()): Date {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next;
}

export function msUntilNextDailyFeatured(now: Date = new Date()): number {
  return Math.max(0, nextDailyFeaturedAt(now).getTime() - now.getTime());
}

export function pickDailyFeaturedGames(
  games: Game[],
  count = DAILY_FEATURED_COUNT,
  random: () => number = Math.random
): Game[] {
  const unique: Game[] = [];
  const seen = new Set<string>();
  for (const game of games) {
    if (!game.id || seen.has(game.id)) continue;
    seen.add(game.id);
    unique.push(game);
  }

  const target = Math.min(count, unique.length);
  return shuffleInPlace([...unique], random).slice(0, target);
}

export function readDailyFeatured(storage: StorageLike): DailyFeaturedRecord | null {
  try {
    const raw = storage.getItem(DAILY_FEATURED_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailyFeaturedRecord;
    if (!parsed || typeof parsed.date !== 'string' || !Array.isArray(parsed.gameIds)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeDailyFeatured(record: DailyFeaturedRecord, storage: StorageLike): void {
  storage.setItem(DAILY_FEATURED_STORAGE_KEY, JSON.stringify(record));
}

export function resolveDailyFeaturedGames(
  games: Game[],
  record: DailyFeaturedRecord | null,
  date: string
): Game[] | null {
  if (!record || record.date !== date) return null;
  const byId = new Map(games.map((game) => [game.id, game]));
  const resolved = record.gameIds
    .map((id) => byId.get(id))
    .filter((game): game is Game => Boolean(game));
  const expected = Math.min(DAILY_FEATURED_COUNT, games.length);
  if (resolved.length !== record.gameIds.length || resolved.length !== expected) {
    return null;
  }
  return resolved;
}

export function getOrCreateDailyFeaturedGames(
  games: Game[],
  storage: StorageLike,
  now: Date = new Date(),
  random: () => number = Math.random
): Game[] {
  if (games.length === 0) return [];

  const date = localDateKey(now);
  const existing = resolveDailyFeaturedGames(games, readDailyFeatured(storage), date);
  if (existing) return existing;

  const picked = pickDailyFeaturedGames(games, DAILY_FEATURED_COUNT, random);
  try {
    writeDailyFeatured(
      { date, gameIds: picked.map((game) => game.id) },
      storage
    );
  } catch {
    // Safari private mode can throw on localStorage writes.
  }
  return picked;
}

export function gamesWithoutFeatured(games: Game[], featured: Game[]): Game[] {
  if (featured.length === 0) return games;
  const featuredIds = new Set(featured.map((game) => game.id));
  return games.filter((game) => !featuredIds.has(game.id));
}
