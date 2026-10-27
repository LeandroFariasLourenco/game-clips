import React from 'react';
import { RecommendationCarousel } from '../components/RecommendationCarousel';
import { GameGrid } from '../components/GameGrid';
import { useLibrary } from '../libraryContext';

export const HomePage: React.FC = () => {
  const { games, filteredGames, searchQuery, onRefreshLocal } = useLibrary();

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
