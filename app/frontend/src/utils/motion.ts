import { useEffect, useState } from 'react';

const MEDIA_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Subscribes to the OS-level "reduce motion" preference. Used to default the
 * response-shape animation to off for users who've opted out of motion.
 * Returns false during SSR or when the matchMedia API is unavailable.
 */
export const usePrefersReducedMotion = (): boolean => {
  const [prefers, setPrefers] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(MEDIA_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(MEDIA_QUERY);
    const listener = (e: MediaQueryListEvent): void => setPrefers(e.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);

  return prefers;
};
