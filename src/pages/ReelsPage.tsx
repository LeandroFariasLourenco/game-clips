import React from 'react';
import { useLocation } from 'react-router-dom';
import { Clapperboard } from 'lucide-react';
import { ReelPlayer } from '../components/ReelPlayer';
import { useLibrary } from '../libraryContext';
import { useReelsFeed } from '../hooks/useReelsFeed';

export const ReelsPage: React.FC = () => {
  const { games, isSyncing } = useLibrary();
  const location = useLocation();
  const active = location.pathname === '/reels';
  const feed = useReelsFeed(games, active);

  return (
    <section
      className="h-[calc(100dvh-var(--app-tabbar))] overflow-hidden bg-black"
      aria-label="Reels"
    >
      {games.length === 0 && !isSyncing ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-zinc-400">
          <Clapperboard className="h-10 w-10 text-zinc-600" />
          <p className="text-sm">Nenhum jogo carregado para recomendar conteúdos.</p>
        </div>
      ) : (
        <ReelPlayer
          stack={feed.stack}
          index={feed.index}
          current={feed.current}
          previous={feed.previous}
          next={feed.next}
          active={active}
          loading={feed.loading}
          canGoPrev={feed.canGoPrev}
          onPrefetchNext={feed.prefetchNext}
          onCommitNext={feed.commitNext}
          onCommitPrev={feed.commitPrev}
          onCompleted={feed.markCompleted}
          onRestartWatch={feed.resetCompleted}
        />
      )}
    </section>
  );
};
