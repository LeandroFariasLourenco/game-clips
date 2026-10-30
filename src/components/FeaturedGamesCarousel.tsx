import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Autoplay, Navigation, Pagination } from 'swiper/modules';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Images, Sparkles } from 'lucide-react';
import { Game } from '../types/game';
import { gameDetailsPath } from '../libraryContext';
import { driveAssetService } from '../services/driveAssetService';
import { ShimmerImage } from '../directives/ShimmerImage';
import { pageTransition } from '../motion';
import { formatRemaining } from '../utils/featuredRotation';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';

interface FeaturedGamesCarouselProps {
  games: Game[];
  remainingMs: number;
}

export const FeaturedGamesCarousel: React.FC<FeaturedGamesCarouselProps> = ({
  games,
  remainingMs,
}) => {
  if (games.length === 0) return null;

  const canLoop = games.length > 1;
  const remainingLabel = formatRemaining(remainingMs);

  return (
    <motion.section
      className="mb-4 sm:mb-10 featured-games-carousel"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageTransition}
    >
      <div className="flex items-center justify-between gap-3 mb-2 sm:mb-4 px-1">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-5 h-5 text-amber-500 shrink-0" />
          <h2 className="text-sm font-bold tracking-wider uppercase text-zinc-300 font-sans">
            Em destaque
          </h2>
        </div>
        <p
          className="text-[11px] sm:text-xs font-mono text-zinc-500 shrink-0 tabular-nums"
          aria-live="polite"
        >
          Novos em {remainingLabel}
        </p>
      </div>

      <Swiper
        modules={[Autoplay, Navigation, Pagination]}
        slidesPerView={1}
        spaceBetween={16}
        loop={canLoop}
        autoplay={canLoop ? { delay: 10000, disableOnInteraction: false } : false}
        pagination={canLoop ? { clickable: true } : false}
        navigation={canLoop ? { enabled: false } : false}
        breakpoints={
          canLoop
            ? {
                640: {
                  navigation: { enabled: true },
                },
              }
            : undefined
        }
        a11y={{
          prevSlideMessage: 'Jogo em destaque anterior',
          nextSlideMessage: 'Próximo jogo em destaque',
        }}
      >
        {games.map((game) => (
          <SwiperSlide key={game.id}>
            <Link
              to={gameDetailsPath(game.name)}
              className="relative block h-[200px] sm:h-[312px] md:h-[380px] rounded-xl sm:rounded-2xl overflow-hidden border border-zinc-800/80 bg-zinc-950 group"
              aria-label={`Ver mídias de ${game.name}`}
              title={game.name}
            >
              <ShimmerImage
                src={driveAssetService.getGameBanner(game)}
                alt=""
                wrapperClassName="absolute inset-0"
                className="w-full h-full object-cover group-hover:scale-[1.02] transition duration-700"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/10" />
              <div className="featured-slide-content absolute bottom-3 sm:bottom-6 left-3 sm:left-14 right-3 sm:right-14 z-10 flex items-end gap-4">
                <div className="hidden sm:block w-[92px] md:w-[110px] aspect-[5/7] rounded-lg overflow-hidden border border-zinc-700/80 shadow-xl shrink-0">
                  <ShimmerImage
                    src={driveAssetService.getGameCover(game)}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-base sm:text-2xl font-bold text-white truncate drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                    {game.name}
                  </p>
                  <span className="mt-1.5 sm:mt-3 inline-flex items-center gap-1.5 px-3 py-1 sm:px-3.5 sm:py-1.5 rounded-full bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/30 transition">
                    <Images className="w-3.5 h-3.5" aria-hidden="true" />
                    Ver mídias
                  </span>
                </div>
              </div>
            </Link>
          </SwiperSlide>
        ))}
      </Swiper>
    </motion.section>
  );
};
