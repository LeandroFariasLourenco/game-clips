import React, { useEffect, useMemo } from 'react';
import { FeaturedGamesCarousel } from '../components/FeaturedGamesCarousel';
import { FeaturedMediaReels } from '../components/FeaturedMediaReels';
import { GameGrid } from '../components/GameGrid';
import {
  FeaturedGamesSkeleton,
  FeaturedMediaSkeleton,
  GameGridSkeleton,
} from '../components/LibraryHomeSkeleton';
import { LibraryToolbar } from '../components/LibraryToolbar';
import { useLibrary } from '../libraryContext';
import { useDailyFeaturedGames } from '../hooks/useDailyFeaturedGames';
import { useFeaturedMedia } from '../hooks/useFeaturedMedia';
import { driveAssetService } from '../services/driveAssetService';
import { warmMediaCache } from '../services/mediaCache';
import { gamesWithoutFeatured } from '../utils/dailyFeaturedGames';

export const HomePage: React.FC = () => {
  const { games, filteredGames, searchQuery, onRefreshLocal, isSyncing } = useLibrary();
  const { featured: featuredGames, remainingMs: featuredRemainingMs } = useDailyFeaturedGames(games);
  const { items: featuredMedia, loading: featuredMediaLoading } = useFeaturedMedia(featuredGames);
  const isSearching = Boolean(searchQuery.trim());
  const isInitialLoad = isSyncing && games.length === 0 && !isSearching;

  const listingGames = useMemo(() => {
    if (isSearching) return filteredGames;
    return gamesWithoutFeatured(filteredGames, featuredGames);
  }, [filteredGames, featuredGames, isSearching]);

  useEffect(() => {
    if (games.length === 0) return;
    const covers = games.map((game) => driveAssetService.getGameCover(game));
    void warmMediaCache(covers);
  }, [games]);

  const hideListing = listingGames.length === 0 && !isSearching && games.length > 0;

  return (
    <div aria-busy={isInitialLoad}>
      {isInitialLoad ? (
        <FeaturedGamesSkeleton />
      ) : (
        !isSearching &&
        featuredGames.length > 0 && (
          <>
            <FeaturedGamesCarousel games={featuredGames} remainingMs={featuredRemainingMs} />
            {featuredMediaLoading ? (
              <FeaturedMediaSkeleton />
            ) : (
              <FeaturedMediaReels items={featuredMedia} />
            )}
          </>
        )
      )}

      <LibraryToolbar />

      {isInitialLoad ? (
        <GameGridSkeleton />
      ) : (
        !hideListing && (
          <GameGrid
            games={listingGames}
            searchQuery={searchQuery}
            onRefreshLocal={onRefreshLocal}
          />
        )
      )}
    </div>
  );
};
