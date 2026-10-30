import React from 'react';

function ShimmerBox({ className }: { className: string }) {
  return (
    <div className={`relative overflow-hidden bg-zinc-900 ${className}`}>
      <div className="image-shimmer" aria-hidden="true" />
    </div>
  );
}

export const FeaturedGamesSkeleton: React.FC = () => (
  <section className="mb-4 sm:mb-10" aria-hidden="true">
    <div className="flex items-center justify-between gap-3 mb-2 sm:mb-4 px-1">
      <div className="flex items-center gap-2">
        <ShimmerBox className="w-5 h-5 rounded" />
        <ShimmerBox className="h-3 w-28 rounded" />
      </div>
      <ShimmerBox className="h-3 w-24 rounded" />
    </div>
    <ShimmerBox className="h-[200px] sm:h-[312px] md:h-[380px] rounded-xl sm:rounded-2xl border border-zinc-800/80" />
    <div className="flex justify-center gap-1.5 pt-3">
      <span className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
      <span className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
      <span className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
    </div>
  </section>
);

export const FeaturedMediaSkeleton: React.FC = () => (
  <section className="mb-4 sm:mb-10" aria-hidden="true">
    <div className="flex items-center gap-2 mb-2 sm:mb-4 px-1">
      <ShimmerBox className="w-5 h-5 rounded" />
      <ShimmerBox className="h-3 w-36 rounded" />
    </div>
    <div className="flex gap-3 overflow-hidden sm:gap-4">
      {Array.from({ length: 4 }, (_, index) => (
        <ShimmerBox
          key={index}
          className="w-[44%] shrink-0 aspect-[9/16] rounded-2xl border border-zinc-800/80 sm:w-[38%] md:w-[34%] lg:w-[28%] xl:w-[22%]"
        />
      ))}
    </div>
  </section>
);

export const GameGridSkeleton: React.FC = () => (
  <section aria-hidden="true">
    <ShimmerBox className="h-3 w-28 rounded mb-2 sm:mb-5 ml-1" />
    <div className="flex flex-col divide-y divide-zinc-800/80 sm:grid sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 sm:gap-x-2.5 sm:gap-y-5 lg:gap-x-3 lg:gap-y-5 sm:divide-y-0">
      {Array.from({ length: 12 }, (_, index) => (
        <div
          key={index}
          className="flex flex-row items-center gap-3 py-1.5 min-h-[52px] sm:min-h-0 sm:flex-col sm:items-stretch sm:gap-2 sm:py-0"
        >
          <ShimmerBox className="w-11 shrink-0 aspect-[5/7] sm:w-full rounded-lg border border-zinc-800/80" />
          <ShimmerBox className="h-3.5 flex-1 sm:flex-none sm:w-4/5 rounded" />
        </div>
      ))}
    </div>
  </section>
);
