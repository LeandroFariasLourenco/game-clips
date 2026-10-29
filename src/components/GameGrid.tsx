import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Game } from '../types/game';
import { getLocalBaseFolderName } from '../services/driveService';
import { gameDetailsPath } from '../libraryContext';
import { LazyGameCover } from './LazyGameCover';
import { Reveal } from './Reveal';
import { revealDelay } from '../motion';
import { ChevronRight, HardDrive, RefreshCw } from 'lucide-react';

interface GameGridProps {
  games: Game[];
  searchQuery?: string;
  onRefreshLocal?: () => void;
}

const ITEMS_PER_PAGE = 18;

export const GameGrid: React.FC<GameGridProps> = ({
  games,
  searchQuery,
  onRefreshLocal,
}) => {
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);
  const observerTarget = useRef<HTMLDivElement>(null);

  // Reset pagination when search query changes
  useEffect(() => {
    setDisplayCount(ITEMS_PER_PAGE);
  }, [searchQuery]);

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setDisplayCount((prev) => Math.min(prev + ITEMS_PER_PAGE, games.length));
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [games.length]);

  const visibleGames = games.slice(0, displayCount);

  if (games.length === 0) {
    const baseFolderName = getLocalBaseFolderName();
    return (
      <div className="py-20 text-center max-w-lg mx-auto">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-purple-400 mb-4 shadow-xl">
          <HardDrive className="w-8 h-8" />
        </div>
        <h3 className="text-base font-bold text-zinc-200">
          {searchQuery
            ? 'Nenhum resultado encontrado'
            : `Biblioteca "${baseFolderName}"`}
        </h3>
        <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
          {searchQuery
            ? `Nenhum jogo corresponde à busca "${searchQuery}".`
            : `A biblioteca busca os jogos no ${baseFolderName} de mídia.`}
        </p>

        {!searchQuery && onRefreshLocal && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={onRefreshLocal}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/30 transition cursor-pointer"
            >
              <RefreshCw className="w-4 h-4 text-white" />
              <span>Recarregar biblioteca</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <section>
      <h2 className="text-sm font-bold tracking-wider uppercase text-zinc-300 font-sans mb-2 sm:mb-5 px-1">
        {searchQuery?.trim() ? 'Resultados da busca' : 'Todos os Jogos'}
      </h2>

      <div className="flex flex-col divide-y divide-zinc-800/80 sm:grid sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 sm:gap-x-2.5 sm:gap-y-5 lg:gap-x-3 lg:gap-y-5 sm:divide-y-0">
        {visibleGames.map((game, index) => (
          <Reveal key={game.id} delay={revealDelay(index, ITEMS_PER_PAGE)} className="min-w-0">
            <Link
              to={gameDetailsPath(game.name)}
              className="group cursor-pointer flex flex-row items-center gap-3 py-1.5 min-h-[52px] sm:min-h-0 sm:flex-col sm:items-stretch sm:gap-2 sm:py-0 transition duration-300 transform-gpu sm:hover:-translate-y-0.5 focus:outline-none"
              aria-label={`Ver mídias de ${game.name}`}
              title={game.name}
            >
              <div className="relative w-11 shrink-0 aspect-[5/7] sm:w-full rounded-lg overflow-hidden bg-zinc-950 border border-zinc-800/80 group-hover:border-purple-500/50 sm:shadow-sm sm:group-hover:shadow-lg sm:group-hover:shadow-purple-500/10 transition duration-300">
                <LazyGameCover game={game} />
              </div>
              <p className="min-w-0 flex-1 sm:flex-none px-0.5 text-sm sm:text-xs font-medium text-zinc-200 sm:text-zinc-300 group-hover:text-white truncate leading-snug">
                {game.name}
              </p>
              <ChevronRight
                className="w-4 h-4 shrink-0 text-zinc-500 group-hover:text-zinc-300 sm:hidden"
                aria-hidden="true"
              />
            </Link>
          </Reveal>
        ))}
      </div>

      {/* Infinite Scroll Anchor */}
      {displayCount < games.length && (
        <div ref={observerTarget} className="py-10 text-center">
          <div className="inline-block w-6 h-6 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
        </div>
      )}
    </section>
  );
};
