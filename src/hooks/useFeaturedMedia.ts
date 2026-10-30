import { useEffect, useState } from 'react';
import { Game } from '../types/game';
import { getGameMetadataUrl } from '../config/mediaConfig';
import { driveAssetService } from '../services/driveAssetService';
import { getGameFolderName } from '../services/driveService';
import { collectGameMediaCacheUrls, warmMediaCache } from '../services/mediaCache';
import { localDateKey } from '../utils/dailyFeaturedGames';
import {
  FeaturedHighlight,
  featuredMediaRandom,
  parseGameMetadata,
  pickGameFeaturedMedia,
  zipFeaturedHighlights,
} from '../utils/featuredMedia';

function gamesKey(games: Game[]): string {
  return games.map((game) => game.id).join('\0');
}

async function loadGameMetadata(game: Game) {
  const response = await fetch(getGameMetadataUrl(getGameFolderName(game)), { cache: 'no-store' });
  if (!response.ok) return null;
  return parseGameMetadata(await response.text());
}

export function useFeaturedMedia(games: Game[]): {
  items: FeaturedHighlight[];
  loading: boolean;
} {
  const key = gamesKey(games);
  const [loadedKey, setLoadedKey] = useState('');
  const [items, setItems] = useState<FeaturedHighlight[]>([]);

  useEffect(() => {
    if (games.length === 0) {
      setItems([]);
      setLoadedKey(key);
      return;
    }

    let cancelled = false;
    const date = localDateKey();

    void (async () => {
      const groups = await Promise.all(
        games.map(async (game) => {
          try {
            const metadata = await loadGameMetadata(game);
            if (!metadata) return [];
            return pickGameFeaturedMedia(game, metadata, featuredMediaRandom(`${date}:${game.id}`)).map(
              (media) => ({
                gameId: game.id,
                gameName: game.name,
                gameIcon: driveAssetService.getGameIcon(game),
                media,
              }),
            );
          } catch (error) {
            console.error(`Falha ao ler metadata.json de ${game.name}:`, error);
            return [];
          }
        }),
      );

      if (cancelled) return;
      const next = zipFeaturedHighlights(groups);
      setItems(next);
      setLoadedKey(key);
      void warmMediaCache(collectGameMediaCacheUrls(next.map((item) => item.media)));
    })();

    return () => {
      cancelled = true;
    };
  }, [games, key]);

  return {
    items: loadedKey === key ? items : [],
    loading: games.length > 0 && loadedKey !== key,
  };
}
