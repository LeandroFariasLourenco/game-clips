import React, { useEffect } from 'react';
import { RecommendationCarousel } from '../components/RecommendationCarousel';
import { GameGrid } from '../components/GameGrid';
import { useLibrary } from '../libraryContext';
import { driveAssetService } from '../services/driveAssetService';
import { warmMediaCache } from '../services/mediaCache';

export const HomePage: React.FC = () => {
  const { games, filteredGames, searchQuery, onRefreshLocal } = useLibrary();

  useEffect(() => {
    if (games.length === 0) return;
    const covers = games.map((game) => driveAssetService.getGameCover(game));
    void warmMediaCache(covers);
  }, [games]);

  return (
    <div>
      {!searchQuery.trim() && games.length > 0 && <RecommendationCarousel games={games} />}

      <GameGrid
        games={filteredGames}
        searchQuery={searchQuery}
        onRefreshLocal={onRefreshLocal}
      />
    </div>
  );
};
