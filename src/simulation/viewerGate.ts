import { useSimulationStore } from './simulationStore';

// Why the viewer can't pick seats right now, or null when they can (or no sale is on screen at all).
export function viewerGate(): string | null {
  const { seatStatus, viewer, replayAtMs, phase } = useSimulationStore.getState();
  if (!seatStatus) return null;
  if (replayAtMs !== null) return 'You are watching a replay. Go back to live to pick seats.';

  switch (viewer.stage) {
    case 'admitted':
      return null;
    case 'queued':
      return `You are in the waiting room${
        viewer.position === null ? '' : ` at position ${viewer.position.toLocaleString()}`
      }. Seats open when you are admitted.`;
    case 'turned-away':
      return 'The sale ended before your turn.';
    case 'none':
    case 'left':
      return phase === 'finished'
        ? 'The sale has ended.'
        : 'Join the waiting room in the Drop Day panel to pick seats during the sale.';
  }
}
