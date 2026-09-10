import { useEffect, useState } from 'react';

export function useCountdown(deadline: number | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (deadline === null) {
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
