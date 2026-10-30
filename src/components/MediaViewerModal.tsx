import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { GameMedia } from '../types/game';
import { videoUrlBesideThumb } from '../config/mediaConfig';
import { overlayTransition } from '../motion';
import { formatMediaCapturedAt } from '../utils/mediaSort';
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
} from 'lucide-react';

interface MediaViewerModalProps {
  media: GameMedia;
  onClose: () => void;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

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
) {
  const width = naturalW * scale;
  const height = naturalH * scale;
  const nextX = width <= viewW ? (viewW - width) / 2 : clamp(x, viewW - width, 0);
  const nextY = height <= viewH ? (viewH - height) / 2 : clamp(y, viewH - height, 0);
  return { x: nextX, y: nextY };
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

export const MediaViewerModal: React.FC<MediaViewerModalProps> = ({ media, onClose }) => {
  useEffect(() => {
    lockBodyScroll();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      unlockBodyScroll();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

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

      {media.type === 'screenshot' || media.type === 'artwork' ? (
        <ImageZoomViewer
          key={media.url}
          src={media.url}
          capturedAt={formatMediaCapturedAt(media.name, media.createdTime)}
        />
      ) : media.type === 'video' ? (
        <VideoPlayback
          key={media.url}
          src={videoUrlBesideThumb(media.url, media.thumbnailUrl, media.name)}
          poster={media.thumbnailUrl}
          capturedAt={formatMediaCapturedAt(media.name, media.createdTime)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-4">
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
      )}
    </motion.div>
  );
};

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

function VideoPlayback({
  src,
  poster,
  capturedAt,
}: {
  src: string;
  poster?: string;
  capturedAt?: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playGenRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const tryPlay = useCallback(async (video: HTMLVideoElement) => {
    const generation = playGenRef.current;
    const play = async (muted: boolean) => {
      video.muted = muted;
      await video.play();
    };

    try {
      await play(false);
    } catch (error) {
      if (isAbortError(error) || generation !== playGenRef.current) return;
      try {
        await play(true);
      } catch (mutedError) {
        if (isAbortError(mutedError) || generation !== playGenRef.current) return;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    playGenRef.current += 1;
    setLoading(true);
    setFailed(false);
    const video = videoRef.current;
    if (video) void tryPlay(video);
  }, [src, tryPlay]);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 sm:p-10">
      <div
        className="relative w-full max-w-5xl aspect-video rounded-xl overflow-hidden bg-black shadow-2xl"
        aria-busy={loading}
      >
        {loading && !failed && (
          <div className="absolute inset-0 z-10 pointer-events-none" aria-hidden="true">
            {poster ? (
              <img
                src={poster}
                alt=""
                className="absolute inset-0 w-full h-full object-cover opacity-35"
              />
            ) : null}
            <div className="image-shimmer" />
          </div>
        )}
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
          playsInline
          preload="auto"
          onLoadStart={() => {
            setFailed(false);
            setLoading(true);
          }}
          onWaiting={() => setLoading(true)}
          onPlaying={() => {
            setLoading(false);
            setFailed(false);
          }}
          onCanPlay={(event) => {
            setLoading(false);
            void tryPlay(event.currentTarget);
          }}
          onError={() => {
            const mediaError = videoRef.current?.error;
            if (mediaError && mediaError.code !== mediaError.MEDIA_ERR_ABORTED) {
              setFailed(true);
            }
            setLoading(false);
          }}
          className="w-full h-full object-contain bg-black"
        >
          Seu navegador não suporta reprodução deste vídeo.
        </video>
      </div>
      <MediaCapturedAtLabel capturedAt={capturedAt} />
    </div>
  );
}

function ImageZoomViewer({ src, capturedAt }: { src: string; capturedAt?: string | null }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);

  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [panning, setPanning] = useState(false);
  const sizedRef = useRef(false);
  const viewModeRef = useRef<'fit' | 'free'>('fit');

  const applyZoom = useCallback(
    (nextScale: number, originX: number, originY: number) => {
      const viewport = viewportRef.current;
      if (!viewport || natural.w <= 0) return;

      const rect = viewport.getBoundingClientRect();
      const viewX = originX - rect.left;
      const viewY = originY - rect.top;
      const clamped = clamp(nextScale, MIN_ZOOM, MAX_ZOOM);
      const imageX = (viewX - offset.x) / scale;
      const imageY = (viewY - offset.y) / scale;
      const nextOffset = clampOffset(
        viewX - imageX * clamped,
        viewY - imageY * clamped,
        rect.width,
        rect.height,
        natural.w,
        natural.h,
        clamped,
      );

      viewModeRef.current = 'free';
      setScale(clamped);
      setOffset(nextOffset);
    },
    [natural.h, natural.w, offset.x, offset.y, scale],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      applyZoom(scale * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
    },
    [applyZoom, scale],
  );

  const setActualSize = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || natural.w <= 0) return;
    const rect = viewport.getBoundingClientRect();
    viewModeRef.current = 'free';
    setScale(1);
    setOffset(centeredOffset(rect.width, rect.height, natural.w, natural.h, 1));
  }, [natural.h, natural.w]);

  const setFit = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || natural.w <= 0) return;
    const rect = viewport.getBoundingClientRect();
    const next = fitScale(rect.width, rect.height, natural.w, natural.h);
    viewModeRef.current = 'fit';
    setScale(next);
    setOffset(centeredOffset(rect.width, rect.height, natural.w, natural.h, next));
  }, [natural.h, natural.w]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      applyZoom(scale * factor, event.clientX, event.clientY);
    }

    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [applyZoom, scale]);

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
      setScale(next);
      setOffset(centeredOffset(rect.width, rect.height, natural.w, natural.h, next));
    });

    observer.observe(viewport);
    return () => observer.disconnect();
  }, [natural.h, natural.w]);

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
    setScale(next);
    setOffset(centeredOffset(rect.width, rect.height, width, height, next));
  }, []);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch' && event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    setPanning(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    setOffset(
      clampOffset(
        drag.originX + (event.clientX - drag.startX),
        drag.originY + (event.clientY - drag.startY),
        rect.width,
        rect.height,
        natural.w,
        natural.h,
        scale,
      ),
    );
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setPanning(false);
    }
  }

  function onDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    const atActual = Math.abs(scale - 1) < 0.02;
    if (atActual) {
      setFit();
      return;
    }
    applyZoom(1, event.clientX, event.clientY);
  }

  function onTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 2) {
      pinchRef.current = null;
      return;
    }
    const [first, second] = [event.touches[0], event.touches[1]];
    pinchRef.current = {
      distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
      scale,
    };
  }

  function onTouchMove(event: React.TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 2 || !pinchRef.current) return;
    event.preventDefault();
    const [first, second] = [event.touches[0], event.touches[1]];
    const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
    const nextScale = pinchRef.current.scale * (distance / pinchRef.current.distance);
    applyZoom(nextScale, (first.clientX + second.clientX) / 2, (first.clientY + second.clientY) / 2);
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
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={() => {
          pinchRef.current = null;
        }}
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
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: '0 0',
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
