import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useLocation, useOutlet, useParams } from 'react-router-dom';
import { Game } from '../types/game';
import {
  findGameByName,
  HOME_CACHE_KEY,
  resolveRouteCacheKey,
  useLibrary,
} from '../libraryContext';
import { pageTransition } from '../motion';

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
    <div className="relative">
      {cachedPages.map(([cacheKey, node]) => (
        <CachedRouteFrame
          key={cacheKey}
          cacheKey={cacheKey}
          isActive={cacheKey === activeKey}
        >
          {node}
        </CachedRouteFrame>
      ))}
      {showLiveOutlet && (isGameRoute || isHome) ? outlet : null}
      {!isHome && !isGameRoute ? outlet : null}
    </div>
  );
}

function CachedRouteFrame({
  cacheKey,
  isActive,
  children,
}: {
  cacheKey: string;
  isActive: boolean;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(isActive);
  const exitX = cacheKey === HOME_CACHE_KEY ? -28 : 32;

  useEffect(() => {
    if (isActive) setVisible(true);
  }, [isActive]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={
        isActive
          ? { opacity: 1, x: 0, y: 0 }
          : { opacity: 0, x: exitX, y: 0 }
      }
      transition={pageTransition}
      onAnimationComplete={() => {
        if (!isActive) setVisible(false);
      }}
      className={
        isActive
          ? 'relative z-[1]'
          : visible
            ? 'absolute inset-0 z-0 overflow-hidden'
            : 'hidden'
      }
      style={{ pointerEvents: isActive ? 'auto' : 'none' }}
      inert={!isActive || undefined}
      aria-hidden={!isActive}
      data-route-cache={cacheKey}
    >
      {children}
    </motion.div>
  );
}
