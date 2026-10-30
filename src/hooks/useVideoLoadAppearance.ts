import { useCallback, useEffect, useRef, useState } from 'react';

const BUFFER_OVERLAY_DELAY_MS = 180;

export function useVideoLoadAppearance(src: string) {
  const [initial, setInitial] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const hasFrameRef = useRef(false);
  const bufferTimerRef = useRef(0);

  useEffect(() => {
    hasFrameRef.current = false;
    setInitial(true);
    setBuffering(false);
    return () => window.clearTimeout(bufferTimerRef.current);
  }, [src]);

  const markFrame = useCallback(() => {
    hasFrameRef.current = true;
    window.clearTimeout(bufferTimerRef.current);
    setInitial(false);
    setBuffering(false);
  }, []);

  const markWaiting = useCallback(() => {
    if (!hasFrameRef.current) return;
    window.clearTimeout(bufferTimerRef.current);
    bufferTimerRef.current = window.setTimeout(() => {
      setBuffering(true);
    }, BUFFER_OVERLAY_DELAY_MS);
  }, []);

  return { initial, buffering, markFrame, markWaiting };
}
