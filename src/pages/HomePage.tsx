import React, { useEffect, useMemo } from 'react';
import { FeaturedGamesCarousel } from '../components/FeaturedGamesCarousel';
import { GameGrid } from '../components/GameGrid';
import { FeaturedGamesSkeleton, GameGridSkeleton } from '../components/LibraryHomeSkeleton';
import { LibraryToolbar } from '../components/LibraryToolbar';
import { useLibrary } from '../libraryContext';
import { useDailyFeaturedGames } from '../hooks/useDailyFeaturedGames';
import { driveAssetService } from '../services/driveAssetService';
import { warmMediaCache } from '../services/mediaCache';
import { gamesWithoutFeatured } from '../utils/dailyFeaturedGames';

export const HomePage: React.FC = () => {
  const { games, filteredGames, searchQuery, onRefreshLocal, isSyncing } = useLibrary();
  const featuredGames = useDailyFeaturedGames(games);
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
        featuredGames.length > 0 && <FeaturedGamesCarousel games={featuredGames} />
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
