import { useEffect, useState } from 'react';

// A self-correcting setTimeout aligned to the next whole-second boundary,
// rather than setInterval(1000) - so the displayed digits don't drift or
// skip under event-loop jitter. Returns null (and schedules nothing) when
// there's no deadline. Crucially, this never writes to the store or any
// shared state: the only thing that re-renders on this tick is whichever
// component calls the hook, never the seat layer.
export function useCountdown(deadline: number | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (deadline === null) {
      // Resetting local display state to match a prop that just became
      // null, not deriving anything from an external read.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRemaining(null);
      return undefined;
    }

    let timeoutId = 0;

    const tick = () => {
      const next = Math.max(0, deadline - Date.now());
      setRemaining(next);
      if (next > 0) {
        const delay = next % 1000 || 1000;
        timeoutId = window.setTimeout(tick, delay);
      }
    };

    tick();

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [deadline]);

  return remaining;
}
