import React, { createContext, useContext, useMemo, useRef } from 'react';
import { useLocation, useOutlet, useParams } from 'react-router-dom';
import { Game } from '../types/game';
import { resolveRouteCacheKey, useLibrary } from '../libraryContext';

interface FrozenRoute {
  cacheKey: string;
  game: Game | null;
}

const FrozenRouteContext = createContext<FrozenRoute | null>(null);

export function useFrozenRoute(): FrozenRoute | null {
  return useContext(FrozenRouteContext);
}

export function CachedOutlet() {
  const location = useLocation();
  const params = useParams<{ gameId?: string }>();
  const outlet = useOutlet();
  const { games } = useLibrary();
  const cacheRef = useRef(new Map<string, React.ReactNode>());

  const isHome = location.pathname === '/' || location.pathname === '';
  const isGameRoute = Boolean(params.gameId);
  const currentGame = useMemo(() => {
    if (!params.gameId) return null;
    const decodedId = decodeURIComponent(params.gameId);
    return games.find((item) => item.id === decodedId) ?? null;
  }, [games, params.gameId]);

  const activeKey = resolveRouteCacheKey(location.pathname, params.gameId, games);
  const canCache = isHome || Boolean(currentGame);

  if (canCache && activeKey && outlet && !cacheRef.current.has(activeKey)) {
    cacheRef.current.set(
      activeKey,
      <FrozenRouteContext.Provider value={{ cacheKey: activeKey, game: currentGame }}>
        {outlet}
      </FrozenRouteContext.Provider>
    );
  }

  const cachedPages = Array.from(cacheRef.current.entries());
  const showLiveOutlet = Boolean(outlet) && (!canCache || !activeKey || !cacheRef.current.has(activeKey));

  return (
    <>
      {cachedPages.map(([cacheKey, node]) => {
        const isActive = cacheKey === activeKey;
        return (
          <div
            key={cacheKey}
            hidden={!isActive}
            inert={!isActive}
            aria-hidden={!isActive}
            data-route-cache={cacheKey}
          >
            {node}
          </div>
        );
      })}
      {showLiveOutlet && (isGameRoute || isHome) ? outlet : null}
      {!isHome && !isGameRoute ? outlet : null}
    </>
  );
}
