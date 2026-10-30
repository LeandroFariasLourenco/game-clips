import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Autoplay, Navigation } from 'swiper/modules';
import { Swiper, SwiperSlide } from 'swiper/react';
import type { Swiper as SwiperInstance } from 'swiper';
import { Film, Image as ImageIcon, Play } from 'lucide-react';
import { GameMedia } from '../types/game';
import { sanitizeVideoSrc } from '../config/mediaConfig';
import { FeaturedHighlight } from '../utils/featuredMedia';
import { ShimmerImage } from '../directives/ShimmerImage';
import { MediaViewerModal } from './MediaViewerModal';
import { pageTransition } from '../motion';
import { releaseMediaElement } from '../utils/releaseMediaElement';
import 'swiper/css';
import 'swiper/css/navigation';

interface FeaturedMediaReelsProps {
  items: FeaturedHighlight[];
}

function isFirefoxAndroid() {
  if (typeof navigator === 'undefined') return false;
  return /Firefox/i.test(navigator.userAgent) && /Android/i.test(navigator.userAgent);
}

function isActiveReelVideo(video: HTMLVideoElement) {
  return Boolean(video.closest('.swiper-slide-active'));
}

function playReelVideo(video: HTMLVideoElement) {
  video.muted = true;
  video.defaultMuted = true;
  video.volume = 0;
  void video
    .play()
    .then(() => {
      if (!isActiveReelVideo(video)) {
        video.pause();
        video.currentTime = 0;
      }
    })
    .catch(() => {});
}

function pauseReelVideo(video: HTMLVideoElement) {
  video.pause();
  if (video.currentTime > 0) video.currentTime = 0;
}

function syncActiveReelMedia(swiper: SwiperInstance) {
  const videos = swiper.el.querySelectorAll<HTMLVideoElement>('video.reel-video');
  videos.forEach((video) => {
    if (isActiveReelVideo(video)) {
      playReelVideo(video);
      return;
    }
    pauseReelVideo(video);
  });
}

export const FeaturedMediaReels: React.FC<FeaturedMediaReelsProps> = ({ items }) => {
  const [selected, setSelected] = useState<GameMedia | null>(null);
  const geckoAndroid = useMemo(() => isFirefoxAndroid(), []);

  if (items.length === 0) return null;

  const canLoop = items.length > 4 && !geckoAndroid;

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
        modules={[Autoplay, Navigation]}
        slidesPerView={2.15}
        spaceBetween={10}
        centeredSlides={!geckoAndroid}
        centerInsufficientSlides={!geckoAndroid}
        cssMode={geckoAndroid}
        observer
        observeParents
        observeSlideChildren
        watchOverflow={false}
        loop={canLoop}
        autoplay={
          items.length > 1
            ? { delay: 6500, disableOnInteraction: false, pauseOnMouseEnter: true }
            : false
        }
        navigation={{ enabled: false }}
        breakpoints={{
          768: {
            slidesPerView: 2.65,
            spaceBetween: 14,
            centeredSlides: false,
            cssMode: false,
            navigation: { enabled: true },
          },
          1024: {
            slidesPerView: 3.4,
            spaceBetween: 16,
            centeredSlides: false,
            cssMode: false,
            navigation: { enabled: true },
          },
          1280: {
            slidesPerView: 4.2,
            spaceBetween: 16,
            centeredSlides: false,
            cssMode: false,
            navigation: { enabled: true },
          },
        }}
        onSwiper={(swiper) => {
          syncActiveReelMedia(swiper);
          requestAnimationFrame(() => {
            swiper.update();
            syncActiveReelMedia(swiper);
          });
        }}
        onSlideChange={syncActiveReelMedia}
        onSlideChangeTransitionEnd={syncActiveReelMedia}
        a11y={{
          containerMessage: 'Carrossel de mídias em destaque',
          prevSlideMessage: 'Mídia anterior',
          nextSlideMessage: 'Próxima mídia',
        }}
      >
        {items.map((item) => (
          <SwiperSlide key={item.media.id}>
            {({ isActive }) => (
              <div className="reel-card">
                <ReelCard item={item} active={isActive} onOpen={() => setSelected(item.media)} />
              </div>
            )}
          </SwiperSlide>
        ))}
      </Swiper>

      <AnimatePresence>
        {selected && (
          <MediaViewerModal
            media={selected}
            items={items.map((item) => item.media)}
            onSelect={setSelected}
            onClose={() => setSelected(null)}
          />
        )}
      </AnimatePresence>
    </motion.section>
  );
};

function FeaturedReelVideo({ src, poster }: { src: string; poster?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video) playReelVideo(video);
  }, [src]);

  useEffect(() => {
    return () => {
      releaseMediaElement(videoRef.current);
    };
  }, []);

  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
      onCanPlay={(event) => {
        if (isActiveReelVideo(event.currentTarget)) playReelVideo(event.currentTarget);
      }}
      className="reel-video reel-kenburns absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
    />
  );
}

const ReelCard: React.FC<{
  item: FeaturedHighlight;
  active?: boolean;
  onOpen: () => void;
}> = ({ item, active = false, onOpen }) => {
  const isVideo = item.media.type === 'video';
  const preview = isVideo ? item.media.thumbnailUrl : item.media.url || item.media.thumbnailUrl;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative block overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950 text-left cursor-pointer transition duration-300 hover:border-purple-500/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
      aria-label={isVideo ? `Reproduzir vídeo de ${item.gameName}` : `Abrir imagem de ${item.gameName}`}
    >
      {preview ? (
        <ShimmerImage
          src={preview}
          alt=""
          draggable={false}
          wrapperClassName="absolute inset-0"
          className="reel-kenburns h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-zinc-900" />
      )}

      {isVideo && item.media.url && active ? (
        <FeaturedReelVideo src={sanitizeVideoSrc(item.media.url)} poster={preview} />
      ) : null}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/5 to-black/25" />

      <span className="absolute top-2.5 left-2.5 z-10 inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
        {isVideo ? <Film className="h-3 w-3 text-rose-300" /> : <ImageIcon className="h-3 w-3 text-purple-300" />}
        {isVideo ? 'Vídeo' : 'Imagem'}
      </span>

      {isVideo && (
        <div className="reel-play-hint pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white shadow-lg backdrop-blur-sm">
            <Play className="ml-0.5 h-5 w-5 fill-white" />
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 z-10 p-3">
        <div className="flex items-center gap-2 min-w-0">
          {item.gameIcon ? (
            <span className="reel-game-icon h-7 w-7 shrink-0 overflow-hidden rounded-md border border-white/20 bg-black/50 shadow-lg">
              <img src={item.gameIcon} alt="" className="h-full w-full object-cover" />
            </span>
          ) : null}
          <p className="truncate text-sm font-semibold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
            {item.gameName}
          </p>
        </div>
      </div>
    </button>
  );
};
