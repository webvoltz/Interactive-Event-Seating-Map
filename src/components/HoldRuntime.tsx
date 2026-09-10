import type { Venue } from '../interfaces/venue.interfaces';
import { useHoldExpiry } from '../hooks/useHoldExpiry';
import { useHoldSync } from '../hooks/useHoldSync';

interface HoldRuntimeProps {
  venue: Venue;
}

// Renders nothing. Exists purely to host the imperative hold-expiry and
// cross-tab-sync subscriptions outside the main render tree - both
// subscribe to the store directly (not via selector hooks), so neither
// this component nor anything it's near ever re-renders because of them.
export default function HoldRuntime({ venue }: HoldRuntimeProps) {
  useHoldExpiry();
  useHoldSync(venue);
  return null;
}
