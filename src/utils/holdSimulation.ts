import type { HoldMap, SeatHold, Venue } from '../interfaces/venue.interfaces';
import { SIMULATED_OWNER } from '../interfaces/venue.interfaces';
import { RELEASE_TICK_MS, SIM_WINDOW_MS } from './holdProtocol';

// A small, fast, non-cryptographic string hash (djb2 variant). Deterministic
// and order-independent - the same seat id always maps to the same offset
// regardless of iteration order, which is what makes seeding reproducible
// without needing a stateful PRNG draw per seat.
export function hash32(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

// Quantized to RELEASE_TICK_MS so hundreds of independently-hashed seats
// still collapse onto a shared grid of release moments, rather than each
// landing on its own distinct millisecond.
export function simulatedExpiry(seatId: string, anchor: number): number {
  const offset = hash32(seatId) % SIM_WINDOW_MS;
  const quantized = Math.max(
    RELEASE_TICK_MS,
    Math.ceil(offset / RELEASE_TICK_MS) * RELEASE_TICK_MS,
  );
  return anchor + quantized;
}

// Seeds a live, expiring hold for every seat venue.json marks `held`, so the
// sample data's static status becomes a real fact instead of a permanent
// one - see seatStatus.ts for why the resolver stops trusting
// `seat.status === 'held'` once this has run.
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
        // Can't actually happen (seeding only touches JSON-held seats,
        // which were never selectable), but one line of insurance against
        // ever handing a "held" status to a seat the user has selected.
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
