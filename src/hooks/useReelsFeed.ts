import { useCallback, useEffect, useRef, useState } from 'react';
import { Game } from '../types/game';
import { abortReelLoad, loadNextReel, ReelEntry } from '../services/reelLoader';
import { classifyReelWatch, ReelWatchOutcome } from '../utils/reelFeed';

export function useReelsFeed(games: Game[], active: boolean) {
  const [stack, setStack] = useState<ReelEntry[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const seenIds = useRef(new Set<string>());
  const completedRef = useRef(false);
  const requestId = useRef(0);
  const pendingCommitRef = useRef(false);
  const loadingRef = useRef(false);
  const stackRef = useRef(stack);
  const indexRef = useRef(index);

  stackRef.current = stack;
  indexRef.current = index;

  const current = stack[index] ?? null;
  const previous = index > 0 ? stack[index - 1] ?? null : null;
  const next = stack[index + 1] ?? null;

  const appendReel = useCallback(async (outcome: ReelWatchOutcome) => {
    if (games.length === 0) return;
    const request = requestId.current + 1;
    requestId.current = request;
    loadingRef.current = true;
    setLoading(true);
    const last = stackRef.current[indexRef.current];
    try {
      const incoming = await loadNextReel({
        games,
        outcome,
        lastGameId: last?.game.id,
        lastMediaId: last?.media.id,
        seenIds: seenIds.current,
      });
      if (request !== requestId.current) return;
      if (!incoming) {
        pendingCommitRef.current = false;
        return;
      }
      seenIds.current.add(incoming.media.id);
      setStack((prev) => {
        if (prev.some((item) => item.media.id === incoming.media.id)) return prev;
        const kept = prev.slice(0, indexRef.current + (last ? 1 : 0));
        const nextStack = last ? [...kept, incoming] : [incoming];
        stackRef.current = nextStack;
        return nextStack;
      });
      pendingCommitRef.current = false;
      completedRef.current = false;
    } finally {
      if (request === requestId.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [games]);

  useEffect(() => {
    if (!active || games.length === 0 || stackRef.current.length > 0) return;
    void appendReel('init');
  }, [active, games, appendReel]);

  useEffect(() => {
    if (!active || !current) return;
    if (stackRef.current[indexRef.current + 1] || loadingRef.current) return;
    void appendReel(classifyReelWatch(completedRef.current));
  }, [active, appendReel, current?.media.id]);

  useEffect(() => {
    if (active) return;
    abortReelLoad();
    requestId.current += 1;
    loadingRef.current = false;
    pendingCommitRef.current = false;
    setLoading(false);
  }, [active]);

  const prefetchNext = useCallback(() => {
    if (stackRef.current[indexRef.current + 1]) return;
    if (loadingRef.current) return;
    void appendReel(classifyReelWatch(completedRef.current));
  }, [appendReel]);

  const commitNext = useCallback(() => {
    const ahead = stackRef.current[indexRef.current + 1];
    completedRef.current = false;
    if (ahead) {
      pendingCommitRef.current = false;
      setIndex((value) => value + 1);
      return true;
    }
    pendingCommitRef.current = true;
    prefetchNext();
    return false;
  }, [prefetchNext]);

  const commitPrev = useCallback(() => {
    if (indexRef.current <= 0) return false;
    abortReelLoad();
    requestId.current += 1;
    loadingRef.current = false;
    pendingCommitRef.current = false;
    completedRef.current = false;
    setLoading(false);
    setIndex((value) => Math.max(0, value - 1));
    return true;
  }, []);

  const markCompleted = useCallback(() => {
    completedRef.current = true;
  }, []);

  const resetCompleted = useCallback(() => {
    completedRef.current = false;
  }, []);

  return {
    stack,
    index,
    current,
    previous,
    next,
    canGoPrev: index > 0,
    loading,
    prefetchNext,
    commitNext,
    commitPrev,
    markCompleted,
    resetCompleted,
  };
}
