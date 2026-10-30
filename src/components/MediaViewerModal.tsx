import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { GameMedia } from '../types/game';
import { videoUrlBesideThumb } from '../config/mediaConfig';
import { mediaSlideTransition, overlayTransition } from '../motion';
import { formatMediaCapturedAt } from '../utils/mediaSort';
import { releaseMediaElement } from '../utils/releaseMediaElement';
import { useVideoLoadAppearance } from '../hooks/useVideoLoadAppearance';
import { VideoBufferOverlay, VideoSkeletonOverlay } from './VideoLoadOverlays';
import {
  X,
  Download,
  Film,
  Image as ImageIcon,
  Archive,
  Clock,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface MediaViewerModalProps {
  media: GameMedia;
  items?: GameMedia[];
  onSelect?: (media: GameMedia) => void;
  onClose: () => void;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const FIT_SNAP_RATIO = 1.04;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 28;
const DOUBLE_TAP_ZOOM = 2.5;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function fitScale(viewW: number, viewH: number, naturalW: number, naturalH: number) {
  if (viewW <= 0 || viewH <= 0 || naturalW <= 0 || naturalH <= 0) return 1;
  return Math.min(viewW / naturalW, viewH / naturalH);
}

function centeredOffset(
  viewW: number,
  viewH: number,
  naturalW: number,
  naturalH: number,
  scale: number,
) {
  return {
    x: (viewW - naturalW * scale) / 2,
    y: (viewH - naturalH * scale) / 2,
  };
}

function clampOffset(
  x: number,
  y: number,
  viewW: number,
  viewH: number,
  naturalW: number,
  naturalH: number,
  scale: number,
  mode: 'center' | 'pan' = 'pan',
) {
  const width = naturalW * scale;
  const height = naturalH * scale;
  const nextX =
    width <= viewW || mode === 'center'
      ? (viewW - width) / 2
      : clamp(x, viewW - width, 0);
  const nextY =
    height <= viewH || mode === 'center'
      ? (viewH - height) / 2
      : clamp(y, viewH - height, 0);
  return { x: nextX, y: nextY };
}

function pointerDistance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pointerMidpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

let bodyScrollLocks = 0;
let lockedBodyStyles: {
  bodyOverflow: string;
  htmlOverflow: string;
  paddingRight: string;
} | null = null;

function lockBodyScroll() {
  if (bodyScrollLocks === 0) {
    const scrollbarGap = window.innerWidth - document.documentElement.clientWidth;
    lockedBodyStyles = {
      bodyOverflow: document.body.style.overflow,
      htmlOverflow: document.documentElement.style.overflow,
      paddingRight: document.body.style.paddingRight,
    };
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    if (scrollbarGap > 0) {
      document.body.style.paddingRight = `${scrollbarGap}px`;
    }
  }
  bodyScrollLocks += 1;
}

function unlockBodyScroll() {
  bodyScrollLocks = Math.max(0, bodyScrollLocks - 1);
  if (bodyScrollLocks > 0 || !lockedBodyStyles) return;
  document.body.style.overflow = lockedBodyStyles.bodyOverflow;
  document.documentElement.style.overflow = lockedBodyStyles.htmlOverflow;
  document.body.style.paddingRight = lockedBodyStyles.paddingRight;
  lockedBodyStyles = null;
}

const SWIPE_MIN_DISTANCE = 64;
const SWIPE_DOMINANCE = 1.35;

const mediaSlideVariants = {
  enter: (direction: number) => ({
    x: `${direction * 100}%`,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: `${direction * -100}%`,
    opacity: 0,
  }),
};

const mediaFadeVariants = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0 },
};

export const MediaViewerModal: React.FC<MediaViewerModalProps> = ({
  media,
  items = [],
  onSelect,
  onClose,
}) => {
  const index = items.findIndex((item) => item.id === media.id);
  const total = items.length;
  const hasPlaylist = Boolean(onSelect && total > 1 && index >= 0);
  const hasPrev = hasPlaylist && index > 0;
  const hasNext = hasPlaylist && index < total - 1;
  const prefersReducedMotion = useReducedMotion();
  const [slide, setSlide] = useState({ index, direction: 0 });
  if (index !== slide.index) {
    setSlide({
      index,
      direction: index > slide.index ? 1 : -1,
    });
  }

  const goBy = useCallback(
    (delta: number) => {
      if (!onSelect || !hasPlaylist) return;
      const next = items[index + delta];
      if (next) onSelect(next);
    },
    [hasPlaylist, index, items, onSelect],
  );

  const goPrev = useCallback(() => goBy(-1), [goBy]);
  const goNext = useCallback(() => goBy(1), [goBy]);

  useEffect(() => {
    lockBodyScroll();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goPrev();
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      unlockBodyScroll();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [goNext, goPrev, onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-50 overflow-y-auto overscroll-none bg-black/90 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={overlayTransition}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 py-3">
        <div className="flex items-center gap-2 text-white bg-zinc-900/80 px-3 py-1.5 rounded-full border border-zinc-800 backdrop-blur-md pointer-events-auto">
          {media.type === 'video' ? (
            <Film className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          ) : media.type === 'screenshot' ? (
            <ImageIcon className="w-3.5 h-3.5 text-purple-400 shrink-0" />
          ) : (
            <Archive className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          )}
          {hasPlaylist ? (
            <span className="text-[11px] font-mono text-zinc-300">
              {index + 1}/{total}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          {media.url && media.url !== '#' && (
            <a
              href={media.url}
              download={media.name}
              target="_blank"
              rel="noreferrer"
              className="p-2 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800 transition"
              title="Baixar arquivo"
            >
              <Download className="w-4 h-4" />
            </a>
          )}
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800 transition cursor-pointer"
            aria-label="Fechar visualizador"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {hasPrev ? (
        <button
          type="button"
          className="hidden md:flex absolute left-3 top-1/2 z-30 h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/80 text-zinc-200 backdrop-blur-md transition hover:bg-zinc-800 hover:text-white pointer-events-auto cursor-pointer"
          aria-label="Mídia anterior"
          title="Anterior"
          onClick={goPrev}
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      ) : null}
      {hasNext ? (
        <button
          type="button"
          className="hidden md:flex absolute right-3 top-1/2 z-30 h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/80 text-zinc-200 backdrop-blur-md transition hover:bg-zinc-800 hover:text-white pointer-events-auto cursor-pointer"
          aria-label="Próxima mídia"
          title="Próxima"
          onClick={goNext}
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      ) : null}

      <div className="absolute inset-0 overflow-hidden">
        <AnimatePresence initial={false} custom={slide.direction}>
          <motion.div
            key={media.id}
            className="absolute inset-0 will-change-transform"
            custom={slide.direction}
            variants={prefersReducedMotion ? mediaFadeVariants : mediaSlideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={mediaSlideTransition}
          >
            {media.type === 'screenshot' || media.type === 'artwork' ? (
              <ImageZoomViewer
                src={media.url}
                capturedAt={formatMediaCapturedAt(media.name, media.createdTime)}
                onSwipePrev={hasPrev ? goPrev : undefined}
                onSwipeNext={hasNext ? goNext : undefined}
              />
            ) : media.type === 'video' ? (
              <VideoPlayback
                src={videoUrlBesideThumb(media.url, media.thumbnailUrl, media.name)}
                poster={media.thumbnailUrl}
                capturedAt={formatMediaCapturedAt(media.name, media.createdTime)}
                onSwipePrev={hasPrev ? goPrev : undefined}
                onSwipeNext={hasNext ? goNext : undefined}
              />
            ) : (
              <BackupFileView
                media={media}
                onSwipePrev={hasPrev ? goPrev : undefined}
                onSwipeNext={hasNext ? goNext : undefined}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

function BackupFileView({
  media,
  onSwipePrev,
  onSwipeNext,
}: {
  media: GameMedia;
  onSwipePrev?: () => void;
  onSwipeNext?: () => void;
}) {
  const swipeRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  return (
    <div
      className="absolute inset-0 flex items-center justify-center p-4"
      onPointerDown={(event) => {
        if (event.button !== 0 || (!onSwipePrev && !onSwipeNext)) return;
        if (event.target instanceof Element && event.target.closest('a, button')) return;
        swipeRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const swipe = swipeRef.current;
        if (!swipe || swipe.pointerId !== event.pointerId) return;
        swipeRef.current = null;
        finishHorizontalSwipe(
          event.clientX - swipe.x,
          event.clientY - swipe.y,
          onSwipePrev,
          onSwipeNext,
        );
      }}
      onPointerCancel={() => {
        swipeRef.current = null;
      }}
    >
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center max-w-md text-zinc-200">
            <Archive className="w-14 h-14 text-indigo-400 mx-auto mb-4" />
            <p className="text-xs text-zinc-400 mt-1">
              Arquivo de backup ou instalador salvo na pasta do jogo.
            </p>
            {media.url && media.url !== '#' && (
              <a
                href={media.url}
                download={media.name}
                className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg transition"
              >
                <Download className="w-4 h-4" />
                <span>Baixar Arquivo</span>
              </a>
            )}
          </div>
        </div>
  );
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function MediaCapturedAtLabel({ capturedAt }: { capturedAt?: string | null }) {
  if (!capturedAt) return null;
  return (
    <p className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
      <Clock className="h-3.5 w-3.5 text-zinc-500 shrink-0" aria-hidden="true" />
      <time>{capturedAt}</time>
    </p>
  );
}

function finishHorizontalSwipe(
  dx: number,
  dy: number,
  onPrev?: () => void,
  onNext?: () => void,
) {
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * SWIPE_DOMINANCE) {
    return false;
  }
  if (dx < 0) onNext?.();
  else onPrev?.();
  return true;
}

function VideoPlayback({
  src,
  poster,
  capturedAt,
  onSwipePrev,
  onSwipeNext,
}: {
  src: string;
  poster?: string;
  capturedAt?: string | null;
  onSwipePrev?: () => void;
  onSwipeNext?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playGenRef = useRef(0);
  const soundOnRef = useRef(false);
  const swipeRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const { initial, buffering, markFrame, markWaiting } = useVideoLoadAppearance(src);
  const [failed, setFailed] = useState(false);
  const canSwipe = Boolean(onSwipePrev || onSwipeNext);

  function isVideoControlHit(event: React.PointerEvent) {
    const video = videoRef.current;
    if (!video) return false;
    const target = event.target;
    if (target instanceof Element && target.closest('button, a, input, textarea')) return true;
    const rect = video.getBoundingClientRect();
    return (
      event.clientY >= rect.bottom - 56 &&
      event.clientX >= rect.left &&
      event.clientX <= rect.right
    );
  }

  const tryPlay = useCallback(async (video: HTMLVideoElement) => {
    const generation = playGenRef.current;
    if (!soundOnRef.current) {
      video.muted = true;
      video.defaultMuted = true;
    }
    try {
      await video.play();
    } catch (error) {
      if (isAbortError(error) || generation !== playGenRef.current) return;
      markFrame();
    }
  }, [markFrame]);

  useEffect(() => {
    playGenRef.current += 1;
    soundOnRef.current = false;
    setFailed(false);
    const video = videoRef.current;
    if (!video) return;
    if (video.getAttribute('src') !== src) {
      video.src = src;
      if (poster) video.poster = poster;
      else video.removeAttribute('poster');
      video.load();
    }
    void tryPlay(video);
    return () => {
      playGenRef.current += 1;
    };
  }, [poster, src, tryPlay]);

  useEffect(() => {
    return () => {
      releaseMediaElement(videoRef.current);
    };
  }, []);

  return (
    <div
      className="absolute inset-0 bg-black"
      onPointerDown={(event) => {
        if (!canSwipe || event.button !== 0 || isVideoControlHit(event)) return;
        swipeRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const swipe = swipeRef.current;
        if (!swipe || swipe.pointerId !== event.pointerId) return;
        swipeRef.current = null;
        finishHorizontalSwipe(
          event.clientX - swipe.x,
          event.clientY - swipe.y,
          onSwipePrev,
          onSwipeNext,
        );
      }}
      onPointerCancel={() => {
        swipeRef.current = null;
      }}
    >
      <div className="absolute inset-0 overflow-hidden bg-black" aria-busy={initial || buffering}>
        {initial && !failed ? <VideoSkeletonOverlay poster={poster} /> : null}
        {buffering && !failed && !initial ? <VideoBufferOverlay /> : null}
        {failed && (
          <p className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-6 text-center text-xs text-zinc-400">
            Não foi possível reproduzir o vídeo.
          </p>
        )}
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          controls
          autoPlay
          muted
          defaultMuted
          playsInline
          preload="auto"
          onLoadStart={() => {
            setFailed(false);
          }}
          onWaiting={markWaiting}
          onStalled={markWaiting}
          onSeeking={markWaiting}
          onLoadedData={markFrame}
          onPlaying={() => {
            markFrame();
            setFailed(false);
          }}
          onSeeked={markFrame}
          onVolumeChange={(event) => {
            soundOnRef.current = !event.currentTarget.muted;
          }}
          onCanPlay={(event) => {
            if (event.currentTarget.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              markFrame();
            }
            void tryPlay(event.currentTarget);
          }}
          onError={() => {
            const mediaError = videoRef.current?.error;
            if (mediaError && mediaError.code !== mediaError.MEDIA_ERR_ABORTED) {
              setFailed(true);
            }
            markFrame();
          }}
          className="h-full w-full object-contain bg-black"
        >
          Seu navegador não suporta reprodução deste vídeo.
        </video>
      </div>
      {capturedAt ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 z-20 flex justify-center px-4">
          <MediaCapturedAtLabel capturedAt={capturedAt} />
        </div>
      ) : null}
    </div>
  );
}

function ImageZoomViewer({
  src,
  capturedAt,
  onSwipePrev,
  onSwipeNext,
}: {
  src: string;
  capturedAt?: string | null;
  onSwipePrev?: () => void;
  onSwipeNext?: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const pinchRef = useRef<{
    distance: number;
    scale: number;
    imageX: number;
    imageY: number;
  } | null>(null);
  const pinchedRef = useRef(false);

  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [panning, setPanning] = useState(false);
  const sizedRef = useRef(false);
  const viewModeRef = useRef<'fit' | 'free'>('fit');
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const skipDblClickRef = useRef(false);
  const [animatingZoom, setAnimatingZoom] = useState(false);
  const zoomAnimTimerRef = useRef(0);
  scaleRef.current = scale;
  offsetRef.current = offset;

  const applyZoom = useCallback(
    (nextScale: number, originX: number, originY: number) => {
      const viewport = viewportRef.current;
      if (!viewport || natural.w <= 0) return;

      const rect = viewport.getBoundingClientRect();
      const viewX = originX - rect.left;
      const viewY = originY - rect.top;
      const currentScale = scaleRef.current;
      const currentOffset = offsetRef.current;
      const clamped = clamp(nextScale, MIN_ZOOM, MAX_ZOOM);
      const imageX = (viewX - currentOffset.x) / currentScale;
      const imageY = (viewY - currentOffset.y) / currentScale;
      const nextOffset = clampOffset(
        viewX - imageX * clamped,
        viewY - imageY * clamped,
        rect.width,
        rect.height,
        natural.w,
        natural.h,
        clamped,
        'pan',
      );

      viewModeRef.current = 'free';
      scaleRef.current = clamped;
      offsetRef.current = nextOffset;
      setScale(clamped);
      setOffset(nextOffset);
    },
    [natural.h, natural.w],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      applyZoom(scaleRef.current * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
    },
    [applyZoom],
  );

  const setActualSize = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || natural.w <= 0) return;
    const rect = viewport.getBoundingClientRect();
    viewModeRef.current = 'free';
    const nextOffset = clampOffset(
      (rect.width - natural.w) / 2,
      (rect.height - natural.h) / 2,
      rect.width,
      rect.height,
      natural.w,
      natural.h,
      1,
      'pan',
    );
    scaleRef.current = 1;
    offsetRef.current = nextOffset;
    setScale(1);
    setOffset(nextOffset);
  }, [natural.h, natural.w]);

  const setFit = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || natural.w <= 0) return;
    const rect = viewport.getBoundingClientRect();
    const next = fitScale(rect.width, rect.height, natural.w, natural.h);
    const nextOffset = centeredOffset(rect.width, rect.height, natural.w, natural.h, next);
    viewModeRef.current = 'fit';
    scaleRef.current = next;
    offsetRef.current = nextOffset;
    setScale(next);
    setOffset(nextOffset);
  }, [natural.h, natural.w]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      applyZoom(scaleRef.current * factor, event.clientX, event.clientY);
    }

    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [applyZoom]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomBy(1.2);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomBy(1 / 1.2);
      } else if (event.key === '0' || event.key === '1') {
        event.preventDefault();
        setActualSize();
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFit();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setActualSize, setFit, zoomBy]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const observer = new ResizeObserver(() => {
      if (viewModeRef.current !== 'fit' || natural.w <= 0) return;
      const rect = viewport.getBoundingClientRect();
      const next = fitScale(rect.width, rect.height, natural.w, natural.h);
      const nextOffset = centeredOffset(rect.width, rect.height, natural.w, natural.h, next);
      scaleRef.current = next;
      offsetRef.current = nextOffset;
      setScale(next);
      setOffset(nextOffset);
    });

    observer.observe(viewport);
    return () => observer.disconnect();
  }, [natural.h, natural.w]);

  const animateZoomChange = useCallback(() => {
    window.clearTimeout(zoomAnimTimerRef.current);
    setAnimatingZoom(true);
    zoomAnimTimerRef.current = window.setTimeout(() => setAnimatingZoom(false), 220);
  }, []);

  useEffect(() => () => window.clearTimeout(zoomAnimTimerRef.current), []);

  const toggleDoubleTapZoom = useCallback(
    (clientX: number, clientY: number) => {
      const viewport = viewportRef.current;
      if (!viewport || natural.w <= 0) return;
      const rect = viewport.getBoundingClientRect();
      const fit = fitScale(rect.width, rect.height, natural.w, natural.h);
      animateZoomChange();
      if (scaleRef.current > fit * FIT_SNAP_RATIO) {
        setFit();
        return;
      }
      applyZoom(clamp(fit * DOUBLE_TAP_ZOOM, MIN_ZOOM, MAX_ZOOM), clientX, clientY);
    },
    [animateZoomChange, applyZoom, natural.h, natural.w, setFit],
  );

  const settleTransform = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || natural.w <= 0) return;
    const rect = viewport.getBoundingClientRect();
    const fit = fitScale(rect.width, rect.height, natural.w, natural.h);
    if (scaleRef.current <= fit * FIT_SNAP_RATIO) {
      setFit();
      return;
    }
    const nextOffset = clampOffset(
      offsetRef.current.x,
      offsetRef.current.y,
      rect.width,
      rect.height,
      natural.w,
      natural.h,
      scaleRef.current,
      'pan',
    );
    offsetRef.current = nextOffset;
    setOffset(nextOffset);
  }, [natural.h, natural.w, setFit]);

  const applyImageSize = useCallback((image: HTMLImageElement) => {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) return;
    sizedRef.current = true;
    const viewport = viewportRef.current;
    setNatural({ w: width, h: height });
    setLoaded(true);
    viewModeRef.current = 'fit';
    if (!viewport) {
      setScale(1);
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const next = fitScale(rect.width, rect.height, width, height);
    const nextOffset = centeredOffset(rect.width, rect.height, width, height, next);
    scaleRef.current = next;
    offsetRef.current = nextOffset;
    setScale(next);
    setOffset(nextOffset);
  }, []);

  function beginPinch() {
    const viewport = viewportRef.current;
    const points = [...pointersRef.current.values()];
    if (!viewport || points.length < 2) return;
    const [first, second] = points;
    const rect = viewport.getBoundingClientRect();
    const mid = pointerMidpoint(first, second);
    const viewX = mid.x - rect.left;
    const viewY = mid.y - rect.top;
    const currentScale = scaleRef.current;
    pinchRef.current = {
      distance: Math.max(pointerDistance(first, second), 1),
      scale: currentScale,
      imageX: (viewX - offsetRef.current.x) / currentScale,
      imageY: (viewY - offsetRef.current.y) / currentScale,
    };
    pinchedRef.current = true;
    dragRef.current = null;
    viewModeRef.current = 'free';
    setPanning(false);
  }

  function updatePinch() {
    const viewport = viewportRef.current;
    const pinch = pinchRef.current;
    const points = [...pointersRef.current.values()];
    if (!viewport || !pinch || points.length < 2) return;
    const [first, second] = points;
    const rect = viewport.getBoundingClientRect();
    const mid = pointerMidpoint(first, second);
    const distance = Math.max(pointerDistance(first, second), 1);
    const nextScale = clamp(pinch.scale * (distance / pinch.distance), MIN_ZOOM, MAX_ZOOM);
    const nextOffset = {
      x: mid.x - rect.left - pinch.imageX * nextScale,
      y: mid.y - rect.top - pinch.imageY * nextScale,
    };
    scaleRef.current = nextScale;
    offsetRef.current = nextOffset;
    setScale(nextScale);
    setOffset(nextOffset);
  }

  function rebasePanFromRemainingPointer() {
    const remaining = pointersRef.current.entries().next().value;
    if (!remaining) {
      dragRef.current = null;
      return;
    }
    const [pointerId, point] = remaining;
    dragRef.current = {
      pointerId,
      startX: point.x,
      startY: point.y,
      originX: offsetRef.current.x,
      originY: offsetRef.current.y,
    };
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    window.clearTimeout(zoomAnimTimerRef.current);
    setAnimatingZoom(false);
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size >= 2) {
      beginPinch();
      return;
    }
    pinchedRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offsetRef.current.x,
      originY: offsetRef.current.y,
    };
    setPanning(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchRef.current && pointersRef.current.size >= 2) {
      updatePinch();
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const nextOffset = clampOffset(
      drag.originX + (event.clientX - drag.startX),
      drag.originY + (event.clientY - drag.startY),
      rect.width,
      rect.height,
      natural.w,
      natural.h,
      scaleRef.current,
      viewModeRef.current === 'fit' ? 'center' : 'pan',
    );
    offsetRef.current = nextOffset;
    setOffset(nextOffset);
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    const tracked = pointersRef.current.has(event.pointerId);
    const drag = dragRef.current;
    const dx = drag && drag.pointerId === event.pointerId ? event.clientX - drag.startX : 0;
    const dy = drag && drag.pointerId === event.pointerId ? event.clientY - drag.startY : 0;
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (pinchRef.current) {
      if (pointersRef.current.size >= 2) {
        beginPinch();
        return;
      }
      pinchRef.current = null;
      if (pointersRef.current.size === 1) {
        rebasePanFromRemainingPointer();
        return;
      }
      dragRef.current = null;
      setPanning(false);
      lastTapRef.current = null;
      settleTransform();
      return;
    }

    if (!tracked || !drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setPanning(false);

    if (pinchedRef.current) {
      pinchedRef.current = false;
      settleTransform();
      return;
    }

    const moved = Math.hypot(dx, dy);
    if (moved < 12) {
      const now = performance.now();
      const last = lastTapRef.current;
      if (
        last &&
        now - last.t < DOUBLE_TAP_MS &&
        Math.hypot(event.clientX - last.x, event.clientY - last.y) < DOUBLE_TAP_PX
      ) {
        lastTapRef.current = null;
        skipDblClickRef.current = true;
        toggleDoubleTapZoom(event.clientX, event.clientY);
        return;
      }
      lastTapRef.current = { t: now, x: event.clientX, y: event.clientY };
      return;
    }

    lastTapRef.current = null;
    if (viewModeRef.current !== 'fit') return;
    finishHorizontalSwipe(dx, dy, onSwipePrev, onSwipeNext);
  }

  function onDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    lastTapRef.current = null;
    if (skipDblClickRef.current) {
      skipDblClickRef.current = false;
      return;
    }
    toggleDoubleTapZoom(event.clientX, event.clientY);
  }

  const percent = Math.round(scale * 100);
  const atActual = Math.abs(scale - 1) < 0.02;
  const viewportRect = viewportRef.current?.getBoundingClientRect();
  const fitValue =
    viewportRect && natural.w > 0
      ? fitScale(viewportRect.width, viewportRect.height, natural.w, natural.h)
      : 1;
  const atFit = Math.abs(scale - fitValue) < 0.02;

  return (
    <div className="absolute inset-0 flex flex-col">
      <div
        ref={viewportRef}
        className={`relative min-h-0 flex-1 overflow-hidden touch-none ${panning ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onDoubleClick={onDoubleClick}
      >
        {!loaded && (
          <div className="absolute inset-0 grid place-items-center text-zinc-500 text-xs">
            Carregando imagem…
          </div>
        )}
        <img
          src={src}
          alt=""
          draggable={false}
          ref={(image) => {
            if (image?.complete && !sizedRef.current) applyImageSize(image);
          }}
          onLoad={(event) => applyImageSize(event.currentTarget)}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: natural.w ? `${natural.w}px` : 'auto',
            height: natural.h ? `${natural.h}px` : 'auto',
            maxWidth: 'none',
            maxHeight: 'none',
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
            transformOrigin: '0 0',
            transition: animatingZoom
              ? 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)'
              : 'none',
            willChange: 'transform',
            visibility: loaded ? 'visible' : 'hidden',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center justify-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-4 py-3">
        <MediaCapturedAtLabel capturedAt={capturedAt} />
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
        <div className="flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/80 p-1 backdrop-blur-md">
          <button
            type="button"
            className="p-2 rounded-full text-zinc-300 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
            title="Reduzir zoom"
            aria-label="Reduzir zoom"
            onClick={() => zoomBy(1 / 1.25)}
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="min-w-[3.5rem] text-center text-xs font-mono text-zinc-200">{percent}%</span>
          <button
            type="button"
            className="p-2 rounded-full text-zinc-300 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
            title="Aumentar zoom"
            aria-label="Aumentar zoom"
            onClick={() => zoomBy(1.25)}
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>
        <button
          type="button"
          className={`px-3 py-2 rounded-full border text-xs font-medium transition cursor-pointer ${
            atActual
              ? 'border-purple-500/70 bg-purple-600/80 text-white'
              : 'border-zinc-800 bg-zinc-900/80 text-zinc-300 hover:text-white'
          }`}
          title="Tamanho real da imagem (100%)"
          aria-label="Tamanho real"
          aria-pressed={atActual}
          onClick={setActualSize}
        >
          100%
        </button>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full border text-xs font-medium transition cursor-pointer ${
            atFit && !atActual
              ? 'border-purple-500/70 bg-purple-600/80 text-white'
              : 'border-zinc-800 bg-zinc-900/80 text-zinc-300 hover:text-white'
          }`}
          title="Ajustar à janela"
          aria-pressed={atFit && !atActual}
          onClick={setFit}
        >
          <Maximize2 className="w-3.5 h-3.5" />
          Ajustar
        </button>
        {loaded && (
          <span className="text-[11px] font-mono text-zinc-500">
            {natural.w} × {natural.h}px
          </span>
        )}
        </div>
      </div>
    </div>
  );
}
