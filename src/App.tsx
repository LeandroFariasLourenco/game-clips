import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MotionConfig } from 'motion/react';
import { Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { Game } from './types/game';
import { localLibraryService } from './services/driveService';
import { LibraryContext, LibraryOutletContext, REELS_PATH } from './libraryContext';
import { AppTabBar } from './components/AppTabBar';
import { WifiOff } from 'lucide-react';

export default function App() {
  const location = useLocation();
  const isReels = location.pathname === REELS_PATH;
  const showTabBar = location.pathname === '/' || isReels;
  const [games, setGames] = useState<Game[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSyncing, setIsSyncing] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const [syncNotification, setSyncNotification] = useState<{
    type: 'success' | 'info' | 'error';
    message: string;
  } | null>(null);

  const loadGames = useCallback(async (forceRefresh = false) => {
    setIsSyncing(true);
    try {
      const res = await localLibraryService.loadLocalGames({ forceRefresh });
      setGames(res.games);
      if (res.error) {
        setSyncNotification({
          type: 'error',
          message: `Aviso ao ler a biblioteca: ${res.error}`,
        });
      } else if (forceRefresh) {
        setSyncNotification({
          type: 'success',
          message: 'Biblioteca recarregada do bucket.',
        });
      }
    } catch (err) {
      setGames([]);
      const errorMsg = err instanceof Error ? err.message : String(err);
      setSyncNotification({
        type: 'error',
        message: `Falha ao buscar jogos no bucket: ${errorMsg}`,
      });
    } finally {
      setIsSyncing(false);
      setTimeout(() => {
        setSyncNotification(null);
      }, 6000);
    }
  }, []);

  const performLocalRefresh = useCallback(() => loadGames(true), [loadGames]);

  useEffect(() => {
    void loadGames(false);
  }, [loadGames]);

  const filteredGames = useMemo(() => {
    if (!searchQuery.trim()) return games;
    const q = searchQuery.toLowerCase().trim();
    return games.filter((game) => {
      const nameMatch = game.name.toLowerCase().includes(q);
      const genreMatch = game.genre?.toLowerCase().includes(q);
      const devMatch = game.developer?.toLowerCase().includes(q);
      const appIdMatch = game.steamAppId?.includes(q);
      return nameMatch || genreMatch || devMatch || appIdMatch;
    });
  }, [games, searchQuery]);

  const outletContext: LibraryOutletContext = {
    games,
    filteredGames,
    searchQuery,
    onSearchChange: setSearchQuery,
    isSyncing,
    onRefreshLocal: performLocalRefresh,
  };

  return (
    <LibraryContext.Provider value={outletContext}>
    <MotionConfig reducedMotion="user">
    <div className={`${isReels ? 'h-dvh overflow-hidden' : 'min-h-screen'} bg-[#121212] text-zinc-100 flex flex-col selection:bg-purple-600 selection:text-white overflow-x-hidden`}>
      <ScrollRestoration getKey={(location) => location.pathname} />

      {syncNotification && !isReels && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
          <div
            className={`px-4 py-2.5 rounded-xl border text-xs flex items-center justify-between shadow-lg transition animate-fadeIn ${
              syncNotification.type === 'success'
                ? 'bg-emerald-950/70 border-emerald-800 text-emerald-200'
                : syncNotification.type === 'error'
                ? 'bg-rose-950/70 border-rose-800 text-rose-200'
                : 'bg-zinc-900 border-zinc-800 text-zinc-300'
            }`}
          >
            <span>{syncNotification.message}</span>
            <button
              onClick={() => setSyncNotification(null)}
              className="text-zinc-400 hover:text-white text-xs ml-4 font-bold"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <main
        className={
          isReels
            ? 'relative min-h-0 flex-1 w-full'
            : `flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-6 ${
                showTabBar ? 'pb-[calc(var(--app-tabbar)+0.75rem)]' : ''
              }`
        }
      >
        <Outlet />
      </main>

      {showTabBar ? <AppTabBar /> : null}

      {!isOnline && (
        <div className={`fixed left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600/90 backdrop-blur-md px-3.5 py-2 text-xs font-medium text-white shadow-xl border border-amber-500/40 animate-bounce ${showTabBar ? 'bottom-[calc(var(--app-tabbar)+0.75rem)]' : 'bottom-4'}`}>
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>Modo Offline — a listagem usa o cache da biblioteca.</span>
        </div>
      )}
    </div>
    </MotionConfig>
    </LibraryContext.Provider>
  );
}
