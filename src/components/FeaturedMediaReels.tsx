import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Navigation } from 'swiper/modules';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Film, Image as ImageIcon, Play } from 'lucide-react';
import { GameMedia } from '../types/game';
import { FeaturedHighlight } from '../utils/featuredMedia';
import { ShimmerImage } from '../directives/ShimmerImage';
import { MediaViewerModal } from './MediaViewerModal';
import { pageTransition } from '../motion';
import 'swiper/css';
import 'swiper/css/navigation';

interface FeaturedMediaReelsProps {
  items: FeaturedHighlight[];
}

export const FeaturedMediaReels: React.FC<FeaturedMediaReelsProps> = ({ items }) => {
  const [selected, setSelected] = useState<GameMedia | null>(null);

  if (items.length === 0) return null;

  return (
    <motion.section
      className="mb-4 sm:mb-10 featured-media-reels"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageTransition}
    >
      <div className="flex items-center gap-2 mb-2 sm:mb-4 px-1">
        <Film className="w-5 h-5 text-rose-400 shrink-0" />
        <h2 className="text-sm font-bold tracking-wider uppercase text-zinc-300 font-sans">
          Mídias em destaque
        </h2>
      </div>

      <Swiper
        modules={[Navigation]}
        slidesPerView={1.18}
        spaceBetween={12}
        centeredSlides
        centerInsufficientSlides
        watchOverflow
        navigation={{ enabled: false }}
        breakpoints={{
          768: {
            slidesPerView: 2.65,
            spaceBetween: 14,
            centeredSlides: false,
            navigation: { enabled: true },
          },
          1024: {
            slidesPerView: 3.4,
            spaceBetween: 16,
            centeredSlides: false,
            navigation: { enabled: true },
          },
          1280: {
            slidesPerView: 4.2,
            spaceBetween: 16,
            centeredSlides: false,
            navigation: { enabled: true },
          },
        }}
        a11y={{
          containerMessage: 'Carrossel de mídias em destaque',
          prevSlideMessage: 'Mídia anterior',
          nextSlideMessage: 'Próxima mídia',
        }}
      >
        {items.map((item) => (
          <SwiperSlide key={item.media.id}>
            <ReelCard item={item} onOpen={() => setSelected(item.media)} />
          </SwiperSlide>
        ))}
      </Swiper>

      <AnimatePresence>
        {selected && (
          <MediaViewerModal
            key={selected.id}
            media={selected}
            onClose={() => setSelected(null)}
          />
        )}
      </AnimatePresence>
    </motion.section>
  );
};

const ReelCard: React.FC<{
  item: FeaturedHighlight;
  onOpen: () => void;
}> = ({ item, onOpen }) => {
  const isVideo = item.media.type === 'video';
  const preview = isVideo ? item.media.thumbnailUrl : item.media.url || item.media.thumbnailUrl;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative block w-full aspect-[9/16] overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950 text-left cursor-pointer transition duration-300 hover:border-purple-500/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
      aria-label={isVideo ? `Reproduzir vídeo de ${item.gameName}` : `Abrir imagem de ${item.gameName}`}
    >
      {preview ? (
        <ShimmerImage
          src={preview}
          alt=""
          draggable={false}
          wrapperClassName="absolute inset-0"
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="absolute inset-0 bg-zinc-900" />
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/5 to-black/25" />

      <span className="absolute top-2.5 left-2.5 z-10 inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
        {isVideo ? <Film className="h-3 w-3 text-rose-300" /> : <ImageIcon className="h-3 w-3 text-purple-300" />}
        {isVideo ? 'Vídeo' : 'Imagem'}
      </span>

      {isVideo && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white shadow-lg backdrop-blur-sm transition duration-300 group-hover:scale-110 group-hover:border-purple-300 group-hover:bg-purple-600/90">
            <Play className="ml-0.5 h-5 w-5 fill-white" />
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 z-10 p-3">
        <p className="truncate text-sm font-semibold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
          {item.gameName}
        </p>
      </div>
    </button>
  );
};
