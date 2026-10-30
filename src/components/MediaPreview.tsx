import React, { useEffect, useRef, useState } from 'react';
import { ShimmerImage } from '../directives/ShimmerImage';
import { releaseMediaElement } from '../utils/releaseMediaElement';

export type MediaPreviewKind = 'image' | 'video';

interface MediaPreviewProps {
  kind: MediaPreviewKind;
  src: string;
  className?: string;
  hoverPlay?: boolean;
  autoPlay?: boolean;
}

function previewTime(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0.15;
  return Math.min(0.35, Math.max(0.05, duration * 0.08));
}

/**
 * Viewport-gated preview. Images use native lazy decode.
 * Videos seek to an early keyframe and paint it — `#t=` + preload=metadata
 * often leaves a black tile.
 */
export const MediaPreview: React.FC<MediaPreviewProps> = ({
  kind,
  src,
  className = '',
  hoverPlay = false,
  autoPlay = false,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true);
      },
      { rootMargin: '160px 280px', threshold: 0.01 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const setVideoNode = (node: HTMLVideoElement | null) => {
    if (videoRef.current && videoRef.current !== node) {
      releaseMediaElement(videoRef.current);
    }
    videoRef.current = node;
  };

  useEffect(() => {
    setImageFailed(false);
  }, [src]);

  const seekPreviewFrame = (video: HTMLVideoElement) => {
    const target = previewTime(video.duration);
    if (Math.abs(video.currentTime - target) > 0.04) {
      video.currentTime = target;
    }
  };

  const paintVideoFrame = async (video: HTMLVideoElement) => {
    if (video.dataset.framed === '1') return;
    seekPreviewFrame(video);
    try {
      await video.play();
      if (!autoPlay) video.pause();
      video.dataset.framed = '1';
    } catch {
      seekPreviewFrame(video);
    }
  };

  return (
    <div ref={rootRef} className="absolute inset-0">
      {kind === 'image' && !imageFailed && (
        <ShimmerImage
          key={src}
          src={visible ? src : undefined}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
          className={className}
        />
      )}

      {kind === 'video' && visible && (
        <video
          ref={setVideoNode}
          key={src}
          src={src}
          muted
          loop={autoPlay}
          playsInline
          preload="metadata"
          autoPlay={autoPlay}
          onLoadedMetadata={(event) => {
            seekPreviewFrame(event.currentTarget);
          }}
          onLoadedData={(event) => {
            void paintVideoFrame(event.currentTarget);
          }}
          onSeeked={(event) => {
            event.currentTarget.dataset.framed = '1';
          }}
          onMouseEnter={(event) => {
            if (!hoverPlay) return;
            event.currentTarget.play().catch(() => {});
          }}
          onMouseLeave={(event) => {
            if (!hoverPlay || autoPlay) return;
            const video = event.currentTarget;
            video.pause();
            seekPreviewFrame(video);
          }}
          className={className}
        />
      )}
    </div>
  );
};
