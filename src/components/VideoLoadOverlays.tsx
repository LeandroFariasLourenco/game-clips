import React from 'react';

export function VideoSkeletonOverlay({ poster }: { poster?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
      {poster ? (
        <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" />
      ) : null}
      <div className="image-shimmer" />
    </div>
  );
}

export function VideoBufferOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-black/30"
      aria-hidden="true"
    >
      <div className="video-buffer-spinner h-10 w-10 rounded-full border-2 border-white/25 border-t-white" />
    </div>
  );
}
