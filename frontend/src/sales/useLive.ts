import { useEffect } from 'react';

/** Refetch on an interval while the page is visible (the "live" boards). */
export function useLive(reload: () => void, ms = 60_000) {
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, ms);
    return () => window.clearInterval(t);
  }, [reload, ms]);
}
