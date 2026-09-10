import { useEffect } from 'react';
import type { HoldMessage, Venue } from '../interfaces/venue.interfaces';
import { useVenueStore } from '../store/seatStore';
import {
  SYNC_TIMEOUT_MS,
  adoptRemoteState,
  ingestPeerHold,
  toWireHolds,
} from '../utils/holdProtocol';
import type { BroadcastChannelLike } from '../utils/holdChannel';
import { createHoldChannel } from '../utils/holdChannel';
import { seedSimulatedHolds } from '../utils/holdSimulation';
import { getSessionId } from '../utils/sessionId';

// Cross-tab wiring: joins the hold channel, answers/asks the join-time
// handshake, seeds the demo simulation if no incumbent replies in time, and
// keeps outbound broadcasts diff-driven rather than wired into the store's
// own actions - toggleSeat/clearSelection/confirmPurchase/runExpiry all
// broadcast correctly without knowing this hook exists.
export function useHoldSync(
  venue: Venue,
  channelFactory?: (name: string) => BroadcastChannelLike | null,
): void {
  useEffect(() => {
    const sessionId = getSessionId();
    let seeded = false;

    const seedFreshSimulation = () => {
      if (seeded) return;
      seeded = true;
      const holds = seedSimulatedHolds(venue, Date.now(), useVenueStore.getState().selectedSeats);
      useVenueStore.getState().seedSimulation(holds);
    };

    // Mutable, closure-local mirrors of what was last broadcast - not store
    // state, since they exist purely to diff against for outbound sync and
    // have no meaning to the rest of the app.
    let lastSelected = new Set<string>();
    let lastExpiresAt: number | null = null;
    let lastSold = new Set<string>();

    const postHold = () => {
      const state = useVenueStore.getState();
      channel.post({
        type: 'hold',
        from: sessionId,
        sentAt: Date.now(),
        seatIds: Array.from(state.selectedSeats),
        expiresAt: state.selectionExpiresAt ?? 0,
      });
    };

    const handleMessage = (message: HoldMessage) => {
      const state = useVenueStore.getState();

      switch (message.type) {
        case 'hello': {
          // Reply with everything I currently know - my own peer holds
          // plus my own live selection, expressed the same way a `hold`
          // would be, so the newcomer's adoption logic doesn't need a
          // special case for "the incumbent's own cart".
          const mine = Array.from(state.selectedSeats, (seatId) => ({
            seatId,
            owner: sessionId,
            expiresAt: state.selectionExpiresAt ?? 0,
          }));
          channel.post({
            type: 'state',
            from: sessionId,
            sentAt: Date.now(),
            to: message.from,
            holds: [...toWireHolds(state.holds), ...mine],
          });
          return;
        }

        case 'state': {
          if (message.to !== sessionId || seeded) return;
          seeded = true;
          const { holds, lostSeatIds } = adoptRemoteState(
            state.selectedSeats,
            sessionId,
            message.holds,
          );
          useVenueStore.getState().seedSimulation(holds);
          if (lostSeatIds.length > 0) useVenueStore.getState().releaseLostSeats(lostSeatIds);
          return;
        }

        case 'hold': {
          const result = ingestPeerHold(state.holds, state.selectedSeats, sessionId, message);
          useVenueStore.getState().setHolds(result.holds);
          if (result.lostSeatIds.length > 0) {
            useVenueStore.getState().releaseLostSeats(result.lostSeatIds);
          }
          if (result.mustRepost) postHold();
          return;
        }

        case 'sold': {
          // Update the outbound diff baseline BEFORE applying the change:
          // applyRemoteSold's set() notifies subscribers (including this
          // hook's own broadcaster) synchronously, so without this the
          // seats just learned about here would look "newly sold by me"
          // and bounce straight back onto the channel.
          message.seatIds.forEach((id) => lastSold.add(id));
          useVenueStore.getState().applyRemoteSold(message.seatIds);
          return;
        }

        case 'goodbye': {
          const result = ingestPeerHold(state.holds, state.selectedSeats, sessionId, {
            from: message.from,
            seatIds: [],
            expiresAt: 0,
          });
          useVenueStore.getState().setHolds(result.holds);
          return;
        }
      }
    };

    const channel = createHoldChannel(sessionId, handleMessage, channelFactory);

    const broadcastIfChanged = () => {
      const state = useVenueStore.getState();

      const selectionChanged =
        state.selectionExpiresAt !== lastExpiresAt ||
        state.selectedSeats.size !== lastSelected.size ||
        Array.from(state.selectedSeats).some((id) => !lastSelected.has(id));

      if (selectionChanged) {
        lastSelected = new Set(state.selectedSeats);
        lastExpiresAt = state.selectionExpiresAt;
        postHold();
      }

      const newlySold = Array.from(state.soldSeats).filter((id) => !lastSold.has(id));
      if (newlySold.length > 0) {
        lastSold = new Set(state.soldSeats);
        channel.post({ type: 'sold', from: sessionId, sentAt: Date.now(), seatIds: newlySold });
      }
    };

    const unsubscribe = useVenueStore.subscribe(broadcastIfChanged);

    channel.post({
      type: 'hello',
      from: sessionId,
      sentAt: Date.now(),
      ownedSeatIds: Array.from(useVenueStore.getState().selectedSeats),
    });

    // No transport at all means no incumbent could ever reply - seed
    // immediately rather than waiting out a timeout that can't resolve.
    let syncTimeoutId = 0;
    if (channel.available) {
      syncTimeoutId = window.setTimeout(seedFreshSimulation, SYNC_TIMEOUT_MS);
    } else {
      seedFreshSimulation();
    }

    const handlePageHide = () => {
      channel.post({ type: 'goodbye', from: sessionId, sentAt: Date.now() });
    };
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.clearTimeout(syncTimeoutId);
      unsubscribe();
      window.removeEventListener('pagehide', handlePageHide);
      channel.close();
    };
  }, [venue, channelFactory]);
}
