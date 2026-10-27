import { useEffect, useRef, useState } from 'react';
import { Game } from '../types/game';
import {
  FeaturedItem,
  FeaturedRotation,
  formatRemaining,
  getOrCreateRotation,
  isRotationValid,
  readRotation,
  remainingMs,
} from '../utils/featuredRotation';

async function collectFeaturedCandidates(_games: Game[]): Promise<FeaturedItem[]> {
  return [];
}

export function useFeaturedRotation(games: Game[]) {
  const [rotation, setRotation] = useState<FeaturedRotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [remainingLabel, setRemainingLabel] = useState('7d 0h');
  const regeneratingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (typeof localStorage === 'undefined') {
        setLoading(false);
        return;
      }

      const existing = readRotation(localStorage);
      const hasLocalMediaPaths = existing?.items.some((item) => item.url.includes('/media/'));
      if (isRotationValid(existing) && !hasLocalMediaPaths) {
        if (!cancelled) {
          setRotation(existing);
          setRemainingLabel(formatRemaining(remainingMs(existing)));
          setLoading(false);
        }
        return;
      }

      if (games.length === 0) {
        if (!cancelled) setLoading(false);
        return;
      }

      if (!cancelled) setLoading(true);
      const candidates = await collectFeaturedCandidates(games);
      if (cancelled) return;

      const next = getOrCreateRotation(candidates, localStorage);
      setRotation(next);
      setRemainingLabel(formatRemaining(remainingMs(next)));
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [games]);

  useEffect(() => {
    if (!rotation) return;

    const tick = async () => {
      const left = remainingMs(rotation);
      setRemainingLabel(formatRemaining(left));
      if (left > 0 || games.length === 0 || regeneratingRef.current) return;

      regeneratingRef.current = true;
      try {
        const candidates = await collectFeaturedCandidates(games);
        const next = getOrCreateRotation(candidates, localStorage, Date.now());
        setRotation(next);
        setRemainingLabel(formatRemaining(remainingMs(next)));
      } finally {
        regeneratingRef.current = false;
      }
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [rotation, games]);

  return { rotation, loading, remainingLabel };
}
