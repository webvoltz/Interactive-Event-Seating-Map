import type { HoldMap, SeatHold, Venue } from '../interfaces/venue.interfaces';
import { SIMULATED_OWNER } from '../interfaces/venue.interfaces';
import { RELEASE_TICK_MS, SIM_WINDOW_MS } from './holdProtocol';

export function hash32(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

export function simulatedExpiry(seatId: string, anchor: number): number {
  const offset = hash32(seatId) % SIM_WINDOW_MS;
  const quantized = Math.max(
    RELEASE_TICK_MS,
    Math.ceil(offset / RELEASE_TICK_MS) * RELEASE_TICK_MS,
  );
  return anchor + quantized;
}

// After this runs, seatStatus.ts stops trusting seat.status === 'held' directly.
export function seedSimulatedHolds(
  venue: Venue,
  anchor: number,
  selectedSeats: ReadonlySet<string>,
): HoldMap {
  const holds = new Map<string, SeatHold>();
  for (const section of venue.sections) {
    for (const row of section.rows) {
      for (const seat of row.seats) {
        if (seat.status !== 'held') continue;
        if (selectedSeats.has(seat.id)) continue;
        holds.set(seat.id, {
          seatId: seat.id,
          owner: SIMULATED_OWNER,
          expiresAt: simulatedExpiry(seat.id, anchor),
        });
      }
    }
  }
  return holds;
}
