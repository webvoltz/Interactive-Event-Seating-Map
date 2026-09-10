import { useEffect } from 'react';
import { useVenueStore } from '../store/seatStore';
import { EXPIRY_SLACK_MS, nextDeadline } from '../utils/holdProtocol';

// Arms exactly one setTimeout, for whichever comes soonest of "a tracked
// hold lapses" or "my own checkout deadline passes" - never a polling
// interval. With nothing to schedule (no holds, no selection), there is no
// timer at all. On fire, it prunes via the store's own runExpiry (a single
// set() that's a no-op when nothing actually lapsed) and re-arms.
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

    // Any store change could move the next deadline earlier or later (a
    // new hold, a cleared selection, ...), so re-check the schedule then.
    const unsubscribe = useVenueStore.subscribe(() => {
      scheduleNext();
    });

    // A backgrounded tab has its timers throttled or fully suspended, so it
    // can come back with hundreds of holds already lapsed at once -
    // runExpiry prunes all of them in a single pass, one store write, not
    // one per seat.
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
