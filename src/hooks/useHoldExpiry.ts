import { useEffect } from 'react';
import { useVenueStore } from '../store/seatStore';
import { EXPIRY_SLACK_MS, nextDeadline } from '../utils/holdProtocol';

export function useHoldExpiry(): void {
  useEffect(() => {
    let timeoutId = 0;

    const scheduleNext = () => {
      window.clearTimeout(timeoutId);
      const { holds, selectionExpiresAt } = useVenueStore.getState();
      const deadline = nextDeadline(holds, selectionExpiresAt);
      if (deadline === null) return;

      const delay = Math.max(0, deadline - Date.now()) + EXPIRY_SLACK_MS;
      timeoutId = window.setTimeout(() => {
        useVenueStore.getState().runExpiry(Date.now());
        scheduleNext();
      }, delay);
    };

    scheduleNext();

    const unsubscribe = useVenueStore.subscribe(() => {
      scheduleNext();
    });

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        useVenueStore.getState().runExpiry(Date.now());
        scheduleNext();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearTimeout(timeoutId);
      unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);
}
