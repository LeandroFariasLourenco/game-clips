import React, { useEffect, useRef, useState } from 'react';
import { Game } from '../types/game';
import { driveAssetService } from '../services/driveAssetService';
import { ShimmerImage } from '../directives/ShimmerImage';
import { Gamepad2 } from 'lucide-react';

interface LazyGameCoverProps {
  game: Game;
  className?: string;
}

export const LazyGameCover: React.FC<LazyGameCoverProps> = ({ game, className = '' }) => {
  const [visible, setVisible] = useState(false);
  const [sourceIndex, setSourceIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const thumbSources = [
    driveAssetService.getGameCover(game),
    driveAssetService.getGameBanner(game),
    driveAssetService.getGameIcon(game),
  ];
  const coverUrl = thumbSources[sourceIndex];
  const failed = sourceIndex >= thumbSources.length;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true);
      },
      { rootMargin: '120px', threshold: 0.01 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setSourceIndex(0);
  }, [game.id]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden bg-zinc-950 flex items-center justify-center ${className}`}
    >
      {failed ? (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800/40">
          <div className="w-8 h-8 rounded-lg bg-zinc-800/60 flex items-center justify-center text-zinc-500">
            <Gamepad2 className="w-4 h-4" />
          </div>
        </div>
      ) : (
        <ShimmerImage
          src={visible ? coverUrl : undefined}
          alt={game.name}
          loading="lazy"
          decoding="async"
          onError={() => setSourceIndex((index) => index + 1)}
          className="w-full h-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.02]"
        />
      )}
    </div>
  );
};
