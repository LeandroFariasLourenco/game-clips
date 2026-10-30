import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, Pause, Volume2, VolumeX } from 'lucide-react';
import { ReelEntry } from '../services/reelLoader';
import { driveAssetService } from '../services/driveAssetService';
import { gameDetailsPath } from '../libraryContext';
import { formatMediaCapturedAt } from '../utils/mediaSort';
import { releaseMediaElement } from '../utils/releaseMediaElement';
import {
  REEL_HOLD_MS,
  REEL_IMAGE_DURATION_MS,
  REEL_SNAP_MS,
  REEL_SWIPE_PX,
  REEL_TAP_PX,
} from '../utils/reelFeed';

interface ReelPlayerProps {
  stack: ReelEntry[];
  index: number;
  current: ReelEntry | null;
  previous: ReelEntry | null;
  next: ReelEntry | null;
  active: boolean;
  loading: boolean;
  canGoPrev: boolean;
  onPrefetchNext: () => void;
  onCommitNext: () => boolean;
  onCommitPrev: () => boolean;
  onCompleted: () => void;
  onRestartWatch: () => void;
}

type SnapDirection = 'next' | 'prev' | null;

export const ReelPlayer: React.FC<ReelPlayerProps> = ({
  stack,
  index,
  current,
  next,
  active,
  loading,
  canGoPrev,
  onPrefetchNext,
  onCommitNext,
  onCommitPrev,
  onCompleted,
  onRestartWatch,
}) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(false);
  const rateRef = useRef(1);
  const elapsedRef = useRef(0);
  const lastTickRef = useRef(0);
  const completedRef = useRef(false);
  const holdTimerRef = useRef(0);
  const snappingRef = useRef<SnapDirection>(null);
  const waitingRef = useRef<SnapDirection>(null);
  const offsetRef = useRef(0);
  const heightRef = useRef(0);
  const skipTransitionRef = useRef(false);
  const pointerRef = useRef<{ id: number; x: number; y: number; holding: boolean; dragging: boolean } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const loadedIdsRef = useRef(new Set<string>());

  const [height, setHeight] = useState(0);
  const [offset, setOffset] = useState(0);
  const [snapping, setSnapping] = useState(false);
  const [paused, setPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const soundOnRef = useRef(false);

  offsetRef.current = offset;
  heightRef.current = height;
  const isVideo = current?.media.type === 'video';

  const applyOffset = (value: number, withTransition: boolean) => {
    skipTransitionRef.current = !withTransition;
    offsetRef.current = value;
    setOffset(value);
    setSnapping(withTransition);
  };

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const update = () => setHeight(node.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    soundOnRef.current = soundOn;
    const video = videoRef.current;
    if (!video) return;
    video.muted = !soundOn;
    video.defaultMuted = !soundOn;
    video.volume = soundOn ? 1 : 0;
  }, [soundOn, current]);

  useEffect(() => {
    completedRef.current = false;
    elapsedRef.current = 0;
    lastTickRef.current = 0;
    rateRef.current = 1;
    setPaused(false);
    setHolding(false);
    setProgress(0);
    setReady(current ? loadedIdsRef.current.has(current.media.id) : false);
    onRestartWatch();
  }, [current?.media.id, onRestartWatch]);

  const finish = useCallback(() => {
    if (completedRef.current || snappingRef.current) return;
    completedRef.current = true;
    setProgress(1);
    onCompleted();
    onPrefetchNext();
    snappingRef.current = 'next';
    applyOffset(-(heightRef.current || window.innerHeight), true);
  }, [onCompleted, onPrefetchNext]);

  useEffect(() => {
    if (!active || !current || paused && !holding || snappingRef.current) return;

    let frame = 0;
    const tick = (now: number) => {
      if (!lastTickRef.current) lastTickRef.current = now;
      const delta = (now - lastTickRef.current) * rateRef.current;
      lastTickRef.current = now;

      if (isVideo) {
        const video = videoRef.current;
        const duration = video?.duration;
        if (video && duration && Number.isFinite(duration) && duration > 0) {
          setProgress(Math.min(1, video.currentTime / duration));
        }
      } else {
        elapsedRef.current += delta;
        const ratio = Math.min(1, elapsedRef.current / REEL_IMAGE_DURATION_MS);
        setProgress(ratio);
        if (ratio >= 1) {
          finish();
          return;
        }
      }
      frame = window.requestAnimationFrame(tick);
    };

    lastTickRef.current = 0;
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [active, current, paused, holding, isVideo, finish]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !current || !isVideo || !active || snappingRef.current) return;
    video.playbackRate = holding ? 2 : paused ? 0 : rateRef.current;
    if (paused && !holding) {
      video.pause();
      return;
    }
    video.muted = !soundOnRef.current;
    video.defaultMuted = !soundOnRef.current;
    video.volume = soundOnRef.current ? 1 : 0;
    void video.play().catch(() => {
      if (soundOnRef.current) return;
      video.muted = true;
      void video.play().catch(() => {});
    });
  }, [active, current, isVideo, paused, holding]);

  const setRate = (rate: number) => {
    rateRef.current = rate;
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    if (rate > 1) {
      void video.play().catch(() => {});
      return;
    }
    if (pausedRef.current) video.pause();
  };

  const settleSnap = useCallback((direction: SnapDirection) => {
    if (direction === 'next') {
      if (onCommitNext()) {
        waitingRef.current = null;
        snappingRef.current = null;
        applyOffset(0, false);
        return;
      }
      waitingRef.current = 'next';
      return;
    }
    if (direction === 'prev') {
      onCommitPrev();
    }
    waitingRef.current = null;
    snappingRef.current = null;
    applyOffset(0, false);
  }, [onCommitNext, onCommitPrev]);

  useEffect(() => {
    if (waitingRef.current !== 'next') return;
    if (next) {
      waitingRef.current = null;
      snappingRef.current = null;
      onCommitNext();
      applyOffset(0, false);
      return;
    }
    if (loading) return;
    waitingRef.current = null;
    snappingRef.current = null;
    applyOffset(0, false);
  }, [next, loading, onCommitNext]);

  const snapTo = (direction: 'next' | 'prev') => {
    if (snappingRef.current) return;
    if (direction === 'prev' && !canGoPrev) {
      applyOffset(0, true);
      return;
    }
    if (direction === 'next') onPrefetchNext();
    videoRef.current?.pause();
    snappingRef.current = direction;
    const distance = heightRef.current || window.innerHeight;
    applyOffset(direction === 'next' ? -distance : distance, true);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || snappingRef.current) return;
    pointerRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      holding: false,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = window.setTimeout(() => {
      const pointer = pointerRef.current;
      if (!pointer || pointer.dragging) return;
      pointer.holding = true;
      setHolding(true);
      setRate(2);
    }, REEL_HOLD_MS);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId || snappingRef.current) return;
    const dy = event.clientY - pointer.y;
    const dx = event.clientX - pointer.x;
    if (Math.abs(dy) <= REEL_TAP_PX && Math.abs(dx) <= REEL_TAP_PX) return;

    window.clearTimeout(holdTimerRef.current);
    if (pointer.holding) {
      pointer.holding = false;
      setHolding(false);
      setRate(1);
    }
    pointer.dragging = true;
    if (dy < -REEL_TAP_PX) onPrefetchNext();
    const max = heightRef.current || window.innerHeight;
    const nextOffset = !canGoPrev && dy > 0 ? dy * 0.28 : dy;
    applyOffset(Math.max(-max, Math.min(max, nextOffset)), false);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    window.clearTimeout(holdTimerRef.current);
    const dy = event.clientY - pointer.y;
    const dx = event.clientX - pointer.x;
    pointerRef.current = null;

    if (pointer.holding) {
      setHolding(false);
      setRate(1);
      return;
    }
    if (pointer.dragging) {
      if (Math.abs(dy) >= REEL_SWIPE_PX && Math.abs(dy) > Math.abs(dx)) {
        snapTo(dy < 0 ? 'next' : 'prev');
        return;
      }
      applyOffset(0, true);
      return;
    }
    if (Math.abs(dy) < REEL_TAP_PX && Math.abs(dx) < REEL_TAP_PX) {
      setPaused((value) => !value);
    }
  };

  const onTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.propertyName !== 'transform') return;
    if (skipTransitionRef.current) {
      skipTransitionRef.current = false;
      return;
    }
    const direction = snappingRef.current;
    if (!direction) {
      setSnapping(false);
      return;
    }
    if (Math.abs(offsetRef.current) < 8) {
      snappingRef.current = null;
      setSnapping(false);
      return;
    }
    settleSnap(direction);
  };

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!active || snappingRef.current) return;
      if (Math.abs(event.deltaY) < 28) return;
      event.preventDefault();
      if (event.deltaY > 0) {
        onPrefetchNext();
        snapTo('next');
      } else {
        snapTo('prev');
      }
    };
    const node = viewportRef.current;
    node?.addEventListener('wheel', onWheel, { passive: false });
    return () => node?.removeEventListener('wheel', onWheel);
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!active || snappingRef.current) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        onPrefetchNext();
        snapTo('next');
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        snapTo('prev');
      } else if (event.key === ' ') {
        event.preventDefault();
        setPaused((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const slideHeight = height || '100%';

  return (
    <div
      ref={viewportRef}
      className="relative h-full w-full touch-none overflow-hidden bg-black select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="absolute inset-x-0 top-0 w-full"
        style={{
          height: height ? height * 3 : '300%',
          transform: `translate3d(0, ${offset - (height || 0)}px, 0)`,
          transition: snapping
            ? `transform ${REEL_SNAP_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
            : 'none',
          willChange: 'transform',
        }}
        onTransitionEnd={onTransitionEnd}
      >
        {(() => {
          const from = Math.max(0, index - 1);
          const to = Math.min(stack.length, index + 2);
          const slides: Array<{
            key: string;
            entry: ReelEntry | null;
            slot: number;
            role: 'previous' | 'current' | 'next';
          }> = [];
          for (let itemIndex = from; itemIndex < to; itemIndex += 1) {
            const entry = stack[itemIndex];
            const slot = itemIndex - index + 1;
            slides.push({
              key: entry.media.id,
              entry,
              slot,
              role: itemIndex === index ? 'current' : itemIndex < index ? 'previous' : 'next',
            });
          }
          if (!next && (loading || snappingRef.current === 'next')) {
            slides.push({ key: 'pending-next', entry: null, slot: 2, role: 'next' });
          }
          if (!current && loading) {
            slides.push({ key: 'pending-current', entry: null, slot: 1, role: 'current' });
          }
          return slides;
        })().map(({ key, entry, slot, role }) => {
          const isCurrent = role === 'current';
          const pendingNext = role === 'next' && !entry;
          return (
            <div
              key={key}
              className="absolute inset-x-0"
              style={{ top: height ? height * slot : `${slot * 100}%`, height: slideHeight }}
            >
              <ReelSlide
                entry={entry}
                playing={isCurrent && active && !paused}
                holding={isCurrent && holding}
                paused={isCurrent && paused}
                progress={isCurrent ? progress : 0}
                ready={!isCurrent || ready}
                loading={isCurrent ? !entry && loading : pendingNext}
                attach={isCurrent ? 'play' : role === 'next' ? 'preload' : 'keep'}
                muted={!soundOn}
                videoRef={isCurrent ? videoRef : undefined}
                onReady={
                  isCurrent
                    ? () => {
                        if (entry) loadedIdsRef.current.add(entry.media.id);
                        setReady(true);
                      }
                    : entry
                      ? () => loadedIdsRef.current.add(entry.media.id)
                      : undefined
                }
                onEnded={isCurrent ? finish : undefined}
              />
              {isCurrent && paused && !holding && current ? (
                <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-5">
                  {isVideo ? (
                    <button
                      type="button"
                      aria-label={soundOn ? 'Silenciar' : 'Ativar áudio'}
                      aria-pressed={soundOn}
                      className="pointer-events-auto rounded-full bg-black/45 p-3 text-white"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSoundOn((value) => !value);
                      }}
                    >
                      {soundOn ? (
                        <Volume2 className="h-7 w-7" />
                      ) : (
                        <VolumeX className="h-7 w-7" />
                      )}
                    </button>
                  ) : null}
                  <div className="rounded-full bg-black/45 p-4">
                    <Pause className="h-10 w-10 fill-white text-white" />
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="absolute right-3 top-1/2 z-40 hidden -translate-y-1/2 flex-col gap-3 md:flex">
        <button
          type="button"
          aria-label="Anterior"
          disabled={!canGoPrev}
          className="rounded-full bg-black/40 p-2 text-white disabled:opacity-30"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => snapTo('prev')}
        >
          <ChevronUp className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="Próximo"
          className="rounded-full bg-black/40 p-2 text-white"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            onPrefetchNext();
            snapTo('next');
          }}
        >
          <ChevronDown className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

function ReelSlide({
  entry,
  playing = false,
  holding = false,
  paused = false,
  progress = 0,
  ready = true,
  loading = false,
  attach = 'play',
  muted = true,
  videoRef,
  onReady,
  onEnded,
}: {
  entry: ReelEntry | null;
  playing?: boolean;
  holding?: boolean;
  paused?: boolean;
  progress?: number;
  ready?: boolean;
  loading?: boolean;
  attach?: 'play' | 'keep' | 'preload';
  muted?: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onReady?: () => void;
  onEnded?: () => void;
}) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const wasPlayingRef = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const isVideo = entry?.media.type === 'video';
  const capturedAt = entry
    ? formatMediaCapturedAt(entry.media.name, entry.media.createdTime)
    : null;

  const setVideoNode = (node: HTMLVideoElement | null) => {
    if (localVideoRef.current && localVideoRef.current !== node) {
      releaseMediaElement(localVideoRef.current);
    }
    localVideoRef.current = node;
    if (videoRef) videoRef.current = node;
  };

  useEffect(() => {
    const video = localVideoRef.current;
    if (!video || !isVideo) return;
    const becamePlaying = playing && !wasPlayingRef.current;
    wasPlayingRef.current = playing;
    if (becamePlaying && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      video.currentTime = 0;
      onReadyRef.current?.();
    }
    if (!playing && !holding) video.pause();
  }, [playing, holding, isVideo]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {entry && !isVideo ? (
        <img
          src={entry.src}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-2xl"
          draggable={false}
        />
      ) : null}
      <div className="absolute inset-0 bg-black/35" />

      <div className="relative z-10 flex h-full w-full items-center justify-center">
        {entry && isVideo ? (
          <video
            ref={setVideoNode}
            src={entry.src}
            muted={muted}
            defaultMuted={muted}
            playsInline
            preload={attach === 'keep' ? 'none' : 'auto'}
            className="max-h-full max-w-full object-contain"
            onLoadedData={onReady}
            onPlaying={onReady}
            onEnded={onEnded}
          />
        ) : entry ? (
          <img
            src={entry.src}
            alt={entry.game.name}
            className="max-h-full max-w-full object-contain"
            draggable={false}
            onLoad={() => onReady?.()}
          />
        ) : null}
      </div>

      {(loading || (entry && !ready && playing)) && (
        <div className="image-shimmer pointer-events-none absolute inset-0 z-20" />
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-24 bg-gradient-to-b from-black/50 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-36 bg-gradient-to-t from-black/70 to-transparent" />

      {entry ? (
        <Link
          to={gameDetailsPath(entry.game.name)}
          className="absolute bottom-7 left-3 z-40 flex max-w-[80%] items-center gap-2.5"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <img
            src={driveAssetService.getGameIcon(entry.game)}
            alt=""
            className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/30"
            draggable={false}
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-white drop-shadow">
              {entry.game.name}
            </span>
            {capturedAt ? (
              <time className="block truncate text-[11px] text-white/75 drop-shadow">
                {capturedAt}
              </time>
            ) : null}
          </span>
        </Link>
      ) : null}

      {playing || paused || holding ? (
        <div className="absolute inset-x-3 bottom-2 z-40 h-[2px] overflow-hidden rounded-full bg-white/25">
          <div className="h-full bg-white" style={{ width: `${progress * 100}%` }} />
        </div>
      ) : null}
    </div>
  );
}
