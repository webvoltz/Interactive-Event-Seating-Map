import type { Venue } from '../interfaces/venue.interfaces';
import { useHoldExpiry } from '../hooks/useHoldExpiry';
import { useHoldSync } from '../hooks/useHoldSync';

interface HoldRuntimeProps {
  venue: Venue;
}

export default function HoldRuntime({ venue }: HoldRuntimeProps) {
  useHoldExpiry();
  useHoldSync(venue);
  return null;
}
