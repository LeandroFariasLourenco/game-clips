import { Game, GameMedia } from '../types/game';

export const REEL_IMAGE_DURATION_MS = 10_000;
export const REEL_HOLD_MS = 180;
export const REEL_SWIPE_PX = 72;
export const REEL_TAP_PX = 12;
export const REEL_SNAP_MS = 380;

export type ReelWatchOutcome = 'init' | 'completed' | 'skipped';

export function classifyReelWatch(completed: boolean): Exclude<ReelWatchOutcome, 'init'> {
  return completed ? 'completed' : 'skipped';
}

export function shuffleCopy<T>(items: T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swap];
    copy[swap] = current;
  }
  return copy;
}

export function orderedGamesForReel(
  games: Game[],
  options: {
    lastGameId?: string;
    outcome: ReelWatchOutcome;
    random?: () => number;
  },
): Game[] {
  const random = options.random ?? Math.random;
  if (games.length === 0) return [];

  const preferred =
    options.outcome === 'completed' && options.lastGameId
      ? games.find((game) => game.id === options.lastGameId)
      : undefined;
  const excludedId = options.outcome === 'skipped' ? options.lastGameId : undefined;
  const rest = shuffleCopy(
    games.filter((game) => game.id !== preferred?.id && game.id !== excludedId),
    random,
  );

  if (preferred) return [preferred, ...rest];
  if (excludedId) {
    const fallback = games.find((game) => game.id === excludedId);
    return fallback ? [...rest, fallback] : rest;
  }
  return shuffleCopy(games, random);
}

export function pickReelMedia(
  media: GameMedia[],
  excludeIds: Iterable<string>,
  random: () => number = Math.random,
): GameMedia | null {
  if (media.length === 0) return null;
  const excluded = new Set(excludeIds);
  const unused = media.filter((item) => !excluded.has(item.id));
  const pool = unused.length > 0 ? unused : media;
  return pool[Math.floor(random() * pool.length)] ?? null;
}
