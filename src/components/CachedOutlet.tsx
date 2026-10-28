import React, { createContext, useContext, useMemo, useRef } from 'react';
import { useLocation, useOutlet, useParams } from 'react-router-dom';
import { Game } from '../types/game';
import { findGameByName, resolveRouteCacheKey, useLibrary } from '../libraryContext';

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
  const params = useParams<{ gameName?: string }>();
  const outlet = useOutlet();
  const { games } = useLibrary();
  const cacheRef = useRef(new Map<string, React.ReactNode>());

  const isHome = location.pathname === '/' || location.pathname === '';
  const isGameRoute = Boolean(params.gameName);
  const currentGame = useMemo(
    () => findGameByName(games, params.gameName) ?? null,
    [games, params.gameName]
  );

  const activeKey = resolveRouteCacheKey(location.pathname, params.gameName, games);
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
