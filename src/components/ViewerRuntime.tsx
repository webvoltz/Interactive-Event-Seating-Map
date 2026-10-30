import { useEffect } from 'react';
import { syncViewerSeats } from '../simulation/simulationController';
import { useSimulationStore } from '../simulation/simulationStore';
import { viewerGate } from '../simulation/viewerGate';
import { useVenueStore } from '../store/seatStore';

// Bridges the booking UI and the sale: while the viewer is admitted, what they select is held in
// the engine (so the crowd competes for it), what they pay for is sold, and what they drop is released.
// At any other time a selection can't exist during a sale, so it is cleared with the reason.
export default function ViewerRuntime(): null {
  useEffect(() => {
    const reconcile = () => {
      const sim = useSimulationStore.getState();
      const venue = useVenueStore.getState();
      if (!sim.seatStatus || !sim.seatIndexById) return;

      // While a past moment is on screen the board is history; leave the held seats alone until live again.
      if (sim.replayAtMs !== null) return;

      const reason = viewerGate();
      if (reason !== null) {
        if (venue.selectedSeats.size > 0) venue.releaseLostSeats([...venue.selectedSeats], reason);
        return;
      }
      syncViewerSeats(venue.selectedSeats, venue.soldSeats, sim.seatIndexById);
    };

    reconcile();
    const stopVenue = useVenueStore.subscribe(reconcile);
    const stopSim = useSimulationStore.subscribe((state, previous) => {
      const changed =
        state.viewer.stage !== previous.viewer.stage ||
        state.seatIndexById !== previous.seatIndexById ||
        state.replayAtMs !== previous.replayAtMs;
      if (changed) reconcile();
    });
    return () => {
      stopVenue();
      stopSim();
    };
  }, []);

  return null;
}
