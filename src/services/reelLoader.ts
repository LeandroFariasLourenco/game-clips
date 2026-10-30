import { getGameMetadataUrl } from '../config/mediaConfig';
import { Game, GameMedia } from '../types/game';
import { allMediaFromMetadata, GameMetadata, parseGameMetadata } from '../utils/featuredMedia';
import { orderedGamesForReel, pickReelMedia, ReelWatchOutcome } from '../utils/reelFeed';
import { getGameFolderName } from './driveService';

export interface ReelEntry {
  game: Game;
  media: GameMedia;
  src: string;
}

const metadataCache = new Map<string, GameMetadata>();
let inflight: AbortController | null = null;
let loadGeneration = 0;

export function abortReelLoad(): void {
  loadGeneration += 1;
  inflight?.abort();
  inflight = null;
}

async function fetchMetadata(game: Game, signal: AbortSignal): Promise<GameMetadata | null> {
  const folder = getGameFolderName(game);
  const cached = metadataCache.get(folder);
  if (cached) return cached;

  const response = await fetch(getGameMetadataUrl(folder), { signal, cache: 'force-cache' });
  if (!response.ok) return null;
  const parsed = parseGameMetadata(await response.text());
  if (!parsed) return null;
  metadataCache.set(folder, parsed);
  return parsed;
}

function resolveSource(media: GameMedia): string {
  return media.url;
}

export async function loadNextReel(options: {
  games: Game[];
  outcome: ReelWatchOutcome;
  lastGameId?: string;
  lastMediaId?: string;
  seenIds: Iterable<string>;
  random?: () => number;
}): Promise<ReelEntry | null> {
  abortReelLoad();
  const controller = new AbortController();
  inflight = controller;
  const generation = loadGeneration;
  const exclude = new Set(options.seenIds);
  if (options.lastMediaId) exclude.add(options.lastMediaId);

  const attempt = async (resetSeen: boolean): Promise<ReelEntry | null> => {
    const skip = resetSeen ? new Set(options.lastMediaId ? [options.lastMediaId] : []) : exclude;
    const order = orderedGamesForReel(options.games, {
      lastGameId: options.lastGameId,
      outcome: options.outcome,
      random: options.random,
    });

    for (const game of order) {
      if (controller.signal.aborted || generation !== loadGeneration) return null;
      let metadata: GameMetadata | null;
      try {
        metadata = await fetchMetadata(game, controller.signal);
      } catch {
        if (controller.signal.aborted || generation !== loadGeneration) return null;
        continue;
      }
      if (!metadata) continue;
      const media = pickReelMedia(allMediaFromMetadata(game, metadata), skip, options.random);
      if (!media) continue;
      if (controller.signal.aborted || generation !== loadGeneration) return null;
      return { game, media, src: resolveSource(media) };
    }
    return null;
  };

  const first = await attempt(false);
  if (first || controller.signal.aborted || generation !== loadGeneration) return first;
  return attempt(true);
}
