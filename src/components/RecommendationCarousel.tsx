import React, { useRef, useState } from 'react';
import { Game, GameMedia } from '../types/game';
import { FeaturedItem, fileNameFromUrl } from '../utils/featuredRotation';
import { useFeaturedRotation } from '../hooks/useFeaturedRotation';
import { MediaViewerModal } from './MediaViewerModal';
import { MediaPreview } from './MediaPreview';
import { Sparkles, ChevronLeft, ChevronRight, Play, Timer } from 'lucide-react';

interface RecommendationCarouselProps {
  games: Game[];
}

function FeaturedMediaPreview({
  item,
  featured,
}: {
  item: FeaturedItem;
  featured?: boolean;
}) {
  return (
    <MediaPreview
      kind={item.type === 'video' ? 'video' : 'image'}
      src={item.url}
      hoverPlay
      autoPlay={Boolean(featured && item.type === 'video')}
      className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition duration-700 brightness-75 group-hover:brightness-90"
    />
  );
}

function featuredItemToMedia(item: FeaturedItem): GameMedia {
  const fileName = fileNameFromUrl(item.url) || item.gameName;
  return {
    id: `featured-${item.gameId}-${item.url}`,
    gameId: item.gameId,
    name: fileName,
    type: item.type === 'video' ? 'video' : 'screenshot',
    mimeType: item.type === 'video' ? 'video/mp4' : 'image/jpeg',
    size: 0,
    url: item.url,
    thumbnailUrl: item.type === 'image' ? item.url : undefined,
  };
}

export const RecommendationCarousel: React.FC<RecommendationCarouselProps> = ({ games }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { rotation, loading, remainingLabel } = useFeaturedRotation(games);
  const [selectedMedia, setSelectedMedia] = useState<GameMedia | null>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const offset = direction === 'left' ? -380 : 380;
      scrollContainerRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  if (games.length === 0) return null;

  const items = rotation?.items ?? [];
  const featuredItem = items[0];
  const secondaryItems = items.slice(1);

  if (!loading && items.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            <h2 className="text-sm font-bold tracking-wider uppercase text-zinc-300 font-sans">
              Em destaque
            </h2>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900 text-zinc-400 border border-zinc-800 text-[11px] font-mono">
            <Timer className="w-3.5 h-3.5 text-amber-400" />
            {loading ? '...' : remainingLabel}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => scroll('left')}
            className="p-1.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition cursor-pointer"
            aria-label="Rolar para esquerda"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => scroll('right')}
            className="p-1.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition cursor-pointer"
            aria-label="Rolar para direita"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        className="flex gap-4 overflow-x-auto pb-4 pt-1 scrollbar-none snap-x snap-mandatory"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {loading && items.length === 0 && (
          <>
            <div className="relative shrink-0 w-[300px] sm:w-[480px] md:w-[560px] h-[280px] sm:h-[320px] rounded-2xl bg-zinc-900/80 border border-zinc-800 animate-pulse" />
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="relative shrink-0 w-[160px] sm:w-[190px] h-[280px] sm:h-[320px] rounded-2xl bg-zinc-900/80 border border-zinc-800 animate-pulse"
              />
            ))}
          </>
        )}

        {featuredItem && (
          <button
            type="button"
            onClick={() => setSelectedMedia(featuredItemToMedia(featuredItem))}
            title={featuredItem.gameName}
            aria-label={`Visualizar mídia de ${featuredItem.gameName}`}
            className="relative shrink-0 w-[300px] sm:w-[480px] md:w-[560px] h-[280px] sm:h-[320px] rounded-2xl overflow-hidden group cursor-pointer snap-start border border-zinc-800/80 hover:border-purple-500/50 shadow-2xl transition duration-300 bg-zinc-950 text-left"
          >
            <FeaturedMediaPreview item={featuredItem} featured />
            <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-[#121212]/40 to-transparent" />
            <div className="absolute top-4 left-4 z-10 flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[11px] font-semibold backdrop-blur-md shadow-lg">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Em destaque</span>
            </div>
            {featuredItem.type === 'video' && (
              <div className="absolute bottom-4 right-4 z-10">
                <span className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-white/95 text-zinc-950 font-bold text-xs shadow-md">
                  <Play className="w-3 h-3 fill-zinc-950" />
                  <span>Clipe</span>
                </span>
              </div>
            )}
          </button>
        )}

        {secondaryItems.map((item) => (
          <button
            type="button"
            key={`${item.gameId}-${item.url}`}
            onClick={() => setSelectedMedia(featuredItemToMedia(item))}
            title={item.gameName}
            aria-label={`Visualizar mídia de ${item.gameName}`}
            className="relative shrink-0 w-[160px] sm:w-[190px] h-[280px] sm:h-[320px] rounded-2xl overflow-hidden group cursor-pointer snap-start border border-zinc-800/80 hover:border-purple-500/50 shadow-xl transition duration-300 bg-zinc-900 text-left"
          >
            <FeaturedMediaPreview item={item} />
            {item.type === 'video' && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-10 h-10 rounded-full bg-black/60 border border-white/20 text-white flex items-center justify-center">
                  <Play className="w-4 h-4 fill-white ml-0.5" />
                </div>
              </div>
            )}
          </button>
        ))}
      </div>

      {selectedMedia && (
        <MediaViewerModal media={selectedMedia} onClose={() => setSelectedMedia(null)} />
      )}
    </section>
  );
};
