export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const pageTransition = {
  duration: 0.38,
  ease: EASE_OUT,
};

export const revealTransition = {
  duration: 0.42,
  ease: EASE_OUT,
};

export const overlayTransition = {
  duration: 0.22,
  ease: EASE_OUT,
};

export function revealDelay(index: number, groupSize = 12): number {
  return Math.min(index % groupSize, groupSize - 1) * 0.035;
}
