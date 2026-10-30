import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, Pause, Volume2, VolumeX } from 'lucide-react';
import { ReelEntry } from '../services/reelLoader';
import { driveAssetService } from '../services/driveAssetService';
import { gameDetailsPath } from '../libraryContext';
import { formatMediaCapturedAt } from '../utils/mediaSort';
import { releaseMediaElement } from '../utils/releaseMediaElement';
import { useVideoLoadAppearance } from '../hooks/useVideoLoadAppearance';
import { VideoBufferOverlay, VideoSkeletonOverlay } from './VideoLoadOverlays';
import {
  REEL_HOLD_MS,
  REEL_IMAGE_DURATION_MS,
  REEL_SNAP_MS,
  REEL_SWIPE_PX,
  REEL_TAP_PX,
  reelFetchPriorityForAttach,
  reelHoldKind,
  reelPreloadForAttach,
  type ReelAttachMode,
  type ReelHoldKind,
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

const REEL_BLUR_BACKDROP_CLASS =
  'pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-2xl';

function formatReelDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

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
  const pointerRef = useRef<{
    id: number;
    x: number;
    y: number;
    holding: boolean;
    holdKind: ReelHoldKind | null;
    dragging: boolean;
  } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const loadedIdsRef = useRef(new Set<string>());

  const [height, setHeight] = useState(0);
  const [offset, setOffset] = useState(0);
  const [snapping, setSnapping] = useState(false);
  const [paused, setPaused] = useState(false);
  const [holdMode, setHoldMode] = useState<ReelHoldKind | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [canWarmNext, setCanWarmNext] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const soundOnRef = useRef(false);
  const scrubbingRef = useRef(false);
  const wantPausedRef = useRef(false);
  const progressTrackRef = useRef<HTMLDivElement | null>(null);

  offsetRef.current = offset;
  heightRef.current = height;
  const isVideo = current?.media.type === 'video';
  const speedHold = holdMode === 'speed';
  const pressPaused = holdMode === 'pause';
  wantPausedRef.current = pressPaused || (paused && !speedHold) || scrubbing;

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
    const blockMenu = (event: Event) => event.preventDefault();
    node.addEventListener('contextmenu', blockMenu, { capture: true });
    return () => {
      observer.disconnect();
      node.removeEventListener('contextmenu', blockMenu, { capture: true });
    };
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
    setHoldMode(null);
    setProgress(0);
    setScrubbing(false);
    scrubbingRef.current = false;
    setReady(current ? loadedIdsRef.current.has(current.media.id) : false);
    setCanWarmNext(false);
    onRestartWatch();
  }, [current?.media.id, onRestartWatch]);

  const seekToRatio = useCallback((ratio: number) => {
    const next = Math.min(1, Math.max(0, ratio));
    setProgress(next);
    const video = videoRef.current;
    const duration = video?.duration;
    if (!video || !duration || !Number.isFinite(duration) || duration <= 0) return;
    video.currentTime = next >= 0.999 ? Math.max(0, duration - 0.05) : next * duration;
  }, []);

  const ratioFromClientX = (clientX: number) => {
    const track = progressTrackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const onProgressPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isVideo || event.button !== 0 || snappingRef.current) return;
    event.stopPropagation();
    event.preventDefault();
    window.clearTimeout(holdTimerRef.current);
    pointerRef.current = null;
    scrubbingRef.current = true;
    setScrubbing(true);
    if (holdMode) {
      setHoldMode(null);
      setRate(1);
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic or already-released pointers */
    }
    seekToRatio(ratioFromClientX(event.clientX));
  };

  const onProgressPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return;
    event.stopPropagation();
    seekToRatio(ratioFromClientX(event.clientX));
  };

  const onProgressPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return;
    event.stopPropagation();
    seekToRatio(ratioFromClientX(event.clientX));
    scrubbingRef.current = false;
    setScrubbing(false);
  };

  const finish = useCallback(() => {
    if (completedRef.current || snappingRef.current || scrubbingRef.current) return;
    completedRef.current = true;
    setProgress(1);
    onCompleted();
    onPrefetchNext();
    snappingRef.current = 'next';
    applyOffset(-(heightRef.current || window.innerHeight), true);
  }, [onCompleted, onPrefetchNext]);

  useEffect(() => {
    if (!active || !current || pressPaused || (paused && !speedHold) || snappingRef.current || scrubbing) return;

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
  }, [active, current, paused, pressPaused, speedHold, isVideo, finish, scrubbing]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !current || !isVideo || !active || snappingRef.current) return;
    video.playbackRate = speedHold ? 2 : wantPausedRef.current ? 0 : rateRef.current;
    if (wantPausedRef.current) {
      video.pause();
      return;
    }
    video.muted = !soundOnRef.current;
    video.defaultMuted = !soundOnRef.current;
    video.volume = soundOnRef.current ? 1 : 0;
    void video.play().then(() => {
      if (wantPausedRef.current) video.pause();
    }).catch(() => {
      if (soundOnRef.current || wantPausedRef.current) return;
      video.muted = true;
      void video.play().then(() => {
        if (wantPausedRef.current) video.pause();
      }).catch(() => {});
    });
  }, [active, current, isVideo, paused, pressPaused, speedHold, scrubbing]);

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
    if (event.target instanceof Element && event.target.closest('[data-reel-game-link]')) return;
    if (event.cancelable) event.preventDefault();
    pointerRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      holding: false,
      holdKind: null,
      dragging: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic or already-released pointers */
    }
    window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = window.setTimeout(() => {
      const pointer = pointerRef.current;
      if (!pointer || pointer.dragging) return;
      const bounds = viewportRef.current?.getBoundingClientRect();
      const kind = reelHoldKind(pointer.x - (bounds?.left ?? 0), bounds?.width ?? window.innerWidth);
      pointer.holding = true;
      pointer.holdKind = kind;
      setHoldMode(kind);
      if (kind === 'speed') setRate(2);
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
      pointer.holdKind = null;
      setHoldMode(null);
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
      setHoldMode(null);
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
      className="reel-player relative h-full w-full touch-none overflow-hidden bg-black select-none"
      onContextMenu={(event) => event.preventDefault()}
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
                playing={isCurrent && active && !pressPaused && (!paused || speedHold)}
                holding={isCurrent && speedHold}
                paused={isCurrent && paused}
                pressPaused={isCurrent && pressPaused}
                speedHold={isCurrent && speedHold}
                scrubbing={isCurrent && scrubbing}
                gameLink={isCurrent}
                progress={isCurrent ? progress : 0}
                progressTrackRef={isCurrent ? progressTrackRef : undefined}
                onProgressPointerDown={isCurrent ? onProgressPointerDown : undefined}
                onProgressPointerMove={isCurrent ? onProgressPointerMove : undefined}
                onProgressPointerUp={isCurrent ? onProgressPointerUp : undefined}
                ready={!isCurrent || ready}
                loading={isCurrent ? !entry && loading : pendingNext}
                attach={isCurrent ? 'play' : role === 'next' ? (canWarmNext ? 'warm' : 'metadata') : 'keep'}
                muted={!soundOn}
                videoRef={isCurrent ? videoRef : undefined}
                onBuffered={isCurrent ? () => setCanWarmNext(true) : undefined}
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
                onEnded={isCurrent && !scrubbing ? finish : undefined}
              />
              {isCurrent && paused && !holdMode && current ? (
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
  pressPaused = false,
  speedHold = false,
  scrubbing = false,
  gameLink = false,
  progress = 0,
  progressTrackRef,
  onProgressPointerDown,
  onProgressPointerMove,
  onProgressPointerUp,
  ready = true,
  loading = false,
  attach = 'play',
  muted = true,
  videoRef,
  onReady,
  onBuffered,
  onEnded,
}: {
  entry: ReelEntry | null;
  playing?: boolean;
  holding?: boolean;
  paused?: boolean;
  pressPaused?: boolean;
  speedHold?: boolean;
  scrubbing?: boolean;
  gameLink?: boolean;
  progress?: number;
  progressTrackRef?: React.RefObject<HTMLDivElement | null>;
  onProgressPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onProgressPointerMove?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onProgressPointerUp?: (event: React.PointerEvent<HTMLDivElement>) => void;
  ready?: boolean;
  loading?: boolean;
  attach?: ReelAttachMode;
  muted?: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onReady?: () => void;
  onBuffered?: () => void;
  onEnded?: () => void;
}) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const blurCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wasPlayingRef = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const isVideo = entry?.media.type === 'video';
  const videoSrc = isVideo ? entry?.src ?? '' : '';
  const { initial, buffering, markFrame, markWaiting } = useVideoLoadAppearance(videoSrc);
  const [videoDuration, setVideoDuration] = useState(0);
  const capturedAt = entry
    ? formatMediaCapturedAt(entry.media.name, entry.media.createdTime)
    : null;

  useEffect(() => {
    const video = localVideoRef.current;
    if (!video || !isVideo) {
      setVideoDuration(0);
      return;
    }
    const applyDuration = () => {
      const duration = video.duration;
      if (duration && Number.isFinite(duration) && duration > 0) {
        setVideoDuration(duration);
      }
    };
    applyDuration();
    video.addEventListener('loadedmetadata', applyDuration);
    video.addEventListener('durationchange', applyDuration);
    return () => {
      video.removeEventListener('loadedmetadata', applyDuration);
      video.removeEventListener('durationchange', applyDuration);
    };
  }, [isVideo, videoSrc]);

  useEffect(() => {
    if (!videoRef) return;
    videoRef.current = localVideoRef.current;
    return () => {
      if (videoRef.current === localVideoRef.current) {
        videoRef.current = null;
      }
    };
  }, [videoRef, videoSrc]);

  useEffect(() => {
    return () => {
      releaseMediaElement(localVideoRef.current);
    };
  }, []);

  useEffect(() => {
    const video = localVideoRef.current;
    if (!video || !isVideo) return;
    if (video.getAttribute('src') !== videoSrc) {
      video.src = videoSrc;
    }
    const becamePlaying = playing && !wasPlayingRef.current;
    wasPlayingRef.current = playing;
    if (becamePlaying) {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        markFrame();
        onReadyRef.current?.();
      }
      video.muted = muted;
      video.defaultMuted = muted;
      void video.play().catch(() => {});
    }
    if (!playing && !holding) video.pause();
  }, [playing, holding, isVideo, markFrame, muted, videoSrc]);

  useEffect(() => {
    if (attach !== 'play' || !isVideo) return;
    const video = localVideoRef.current;
    if (!video) return;
    video.currentTime = 0;
  }, [attach, isVideo, videoSrc]);

  useEffect(() => {
    const video = localVideoRef.current;
    if (!video || !isVideo) return;
    const preload = reelPreloadForAttach(attach);
    if (video.preload !== preload) video.preload = preload;
  }, [attach, isVideo]);

  useEffect(() => {
    if (!isVideo) return;
    const video = localVideoRef.current;
    const canvas = blurCanvasRef.current;
    if (!video || !canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const paint = () => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return;
      const width = 64;
      const height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * width));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.drawImage(video, 0, 0, width, height);
    };

    let frame = 0;
    const live = playing || holding || scrubbing;
    const tick = () => {
      paint();
      if (live) frame = window.requestAnimationFrame(tick);
    };
    paint();
    if (live) frame = window.requestAnimationFrame(tick);
    video.addEventListener('loadeddata', paint);
    video.addEventListener('seeked', paint);
    return () => {
      window.cancelAnimationFrame(frame);
      video.removeEventListener('loadeddata', paint);
      video.removeEventListener('seeked', paint);
    };
  }, [holding, isVideo, playing, scrubbing, videoSrc]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {entry && isVideo ? (
        <>
          {entry.media.thumbnailUrl ? (
            <img
              src={entry.media.thumbnailUrl}
              alt=""
              aria-hidden
              className={REEL_BLUR_BACKDROP_CLASS}
              draggable={false}
            />
          ) : null}
          <canvas ref={blurCanvasRef} aria-hidden className={REEL_BLUR_BACKDROP_CLASS} />
        </>
      ) : entry ? (
        <img
          src={entry.src}
          alt=""
          aria-hidden
          className={REEL_BLUR_BACKDROP_CLASS}
          draggable={false}
        />
      ) : null}
      <div className="absolute inset-0 bg-black/35" />

      <div className="relative z-10 flex h-full w-full items-center justify-center">
        {entry && isVideo ? (
          <video
            ref={localVideoRef}
            src={entry.src}
            muted={muted}
            defaultMuted={muted}
            playsInline
            disablePictureInPicture
            controlsList="nodownload nofullscreen noremoteplayback"
            preload={reelPreloadForAttach(attach)}
            fetchPriority={reelFetchPriorityForAttach(attach)}
            className="max-h-full max-w-full object-contain"
            onContextMenu={(event) => event.preventDefault()}
            onWaiting={markWaiting}
            onStalled={markWaiting}
            onSeeking={scrubbing ? undefined : markWaiting}
            onProgress={(event) => {
              if (event.currentTarget.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
                onBuffered?.();
              }
            }}
            onCanPlay={(event) => {
              if (event.currentTarget.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
                onBuffered?.();
              }
            }}
            onCanPlayThrough={() => onBuffered?.()}
            onLoadedMetadata={() => {
              if (attach !== 'play') onReady?.();
            }}
            onLoadedData={() => {
              markFrame();
              onReady?.();
            }}
            onPlaying={() => {
              markFrame();
              onReady?.();
            }}
            onSeeked={markFrame}
            onEnded={onEnded}
          />
        ) : entry ? (
          <img
            src={entry.src}
            alt={entry.game.name}
            className="max-h-full max-w-full object-contain"
            draggable={false}
            onContextMenu={(event) => event.preventDefault()}
            fetchPriority={reelFetchPriorityForAttach(attach)}
            decoding={attach === 'play' ? 'sync' : 'async'}
            onLoad={() => {
              onReady?.();
              onBuffered?.();
            }}
          />
        ) : null}
      </div>

      {loading || (entry && playing && (isVideo ? initial : !ready)) ? (
        <div className="pointer-events-none absolute inset-0 z-20">
          <VideoSkeletonOverlay poster={isVideo ? undefined : entry?.src} />
        </div>
      ) : null}
      {entry && isVideo && buffering && !initial ? (
        <div className="pointer-events-none absolute inset-0 z-20">
          <VideoBufferOverlay />
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-24 bg-gradient-to-b from-black/50 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-36 bg-gradient-to-t from-black/70 to-transparent" />

      {entry ? (
        <Link
          to={gameDetailsPath(entry.game.name)}
          data-reel-game-link=""
          aria-label={`Ver detalhes de ${entry.game.name}`}
          tabIndex={gameLink ? undefined : -1}
          aria-hidden={!gameLink}
          className={`absolute bottom-14 left-3 z-50 flex max-w-[80%] items-center gap-2.5 ${
            gameLink ? 'cursor-pointer' : 'pointer-events-none'
          }`}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onPointerCancel={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <img
            src={driveAssetService.getGameCover(entry.game)}
            alt=""
            className="h-9 aspect-[5/7] shrink-0 rounded-md object-cover ring-1 ring-white/30"
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

      {playing || paused || holding || pressPaused || scrubbing ? (
        <div
          className={`absolute inset-x-0 bottom-0 z-40 flex items-end px-3 ${
            isVideo ? 'h-12 cursor-pointer touch-none pb-1.5' : 'pointer-events-none h-12 pb-1.5'
          }`}
          role={isVideo ? 'slider' : undefined}
          aria-label={isVideo ? 'Progresso do vídeo' : undefined}
          aria-valuemin={isVideo ? 0 : undefined}
          aria-valuemax={isVideo ? 100 : undefined}
          aria-valuenow={isVideo ? Math.round(progress * 100) : undefined}
          onPointerDown={isVideo ? onProgressPointerDown : undefined}
          onPointerMove={isVideo ? onProgressPointerMove : undefined}
          onPointerUp={isVideo ? onProgressPointerUp : undefined}
          onPointerCancel={isVideo ? onProgressPointerUp : undefined}
        >
          {speedHold ? (
            <span className="pointer-events-none absolute inset-x-3 bottom-5 text-center text-[11px] font-semibold tracking-wide text-white drop-shadow">
              reproduzindo em 2x
            </span>
          ) : isVideo && videoDuration > 0 ? (
            <span className="pointer-events-none absolute right-3 bottom-5 text-[11px] font-medium tabular-nums text-white/90 drop-shadow">
              {formatReelDuration(videoDuration)}
            </span>
          ) : null}
          <div
            ref={isVideo ? progressTrackRef : undefined}
            className={`w-full overflow-hidden rounded-full bg-white/25 transition-[height] duration-150 ${
              scrubbing ? 'h-1.5' : 'h-[2px]'
            }`}
          >
            <div className="h-full bg-white" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
