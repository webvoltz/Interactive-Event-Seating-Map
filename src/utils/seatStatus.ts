import type { EffectiveSeatStatus, HoldMap, ISeat } from '../interfaces/venue.interfaces';

export interface SeatStatusOverlays {
  soldSeats: ReadonlySet<string>;
  holds: HoldMap;
  selectedSeats: ReadonlySet<string>;
  now: number;
  // Whether the runtime simulation has taken over from venue.json's static
  // `held` field yet - see the comment on the `held` branch below.
  simulationSeeded: boolean;
}

// Centralises what used to be scattered boolean derivation in Seat.tsx into
// one precedence order, so every consumer (rendering, aria-label, keyboard
// nav) agrees on what a seat "is" at a given instant.
export function resolveSeatStatus(
  seat: Pick<ISeat, 'id' | 'status'>,
  overlays: SeatStatusOverlays,
): EffectiveSeatStatus {
  const { soldSeats, holds, selectedSeats, now, simulationSeeded } = overlays;

  // A sale is terminal - it outranks everything, including a seat this tab
  // still thinks it has selected (e.g. a remote purchase notification).
  if (seat.status === 'sold' || soldSeats.has(seat.id)) return 'sold';

  // Checked before `selected` as a fail-safe, not because it's expected to
  // fire in the common case: the store keeps selectedSeats and live foreign
  // holds disjoint, but for the one frame after a reload with a persisted
  // selection another tab has since claimed, this is what stops the seat
  // from rendering as falsely "mine" before reconciliation runs.
  const hold = holds.get(seat.id);
  if (hold && hold.expiresAt > now) return 'held';

  if (selectedSeats.has(seat.id)) return 'selected';

  if (seat.status === 'reserved') return 'reserved';

  // venue.json's `held` is a seeding INSTRUCTION, not a live fact - before
  // seeding runs it should still read as held (no flash of hundreds of
  // seats going available), but once seeded, `holds` is the only
  // authority. Falling back to this field even after seeding would mean a
  // lapsed-and-pruned simulated hold silently reverts to held forever.
  if (seat.status === 'held' && !simulationSeeded) return 'held';

  return 'available';
}

export function isSeatSelectable(status: EffectiveSeatStatus): boolean {
  return status === 'available' || status === 'selected';
}

export function describeSeatStatus(status: EffectiveSeatStatus): string {
  switch (status) {
    case 'sold':
      return 'sold';
    case 'reserved':
      return 'reserved';
    case 'held':
      return 'temporarily held by another customer';
    case 'selected':
      return 'selected';
    case 'available':
      return 'available';
  }
}

interface SeatStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  textColor: string;
}

// A module-level lookup rather than an if/else ladder recomputed per seat
// per render - the fill/stroke/text-color triple no longer needs deriving,
// just looking up. `available`'s stroke is a fallback only: Seat.tsx still
// overrides it per price tier, the one piece of styling this table can't
// express since it depends on the seat, not just its status.
export const SEAT_STATUS_STYLE: Record<EffectiveSeatStatus, SeatStyle> = {
  available: {
    fill: 'var(--color-seat-available)',
    stroke: 'var(--color-seat-available-stroke)',
    strokeWidth: 0.35,
    textColor: '#334155',
  },
  selected: {
    fill: 'var(--color-seat-selected)',
    stroke: 'white',
    strokeWidth: 0.4,
    textColor: 'white',
  },
  sold: {
    fill: 'var(--color-seat-sold)',
    stroke: 'none',
    strokeWidth: 0,
    textColor: '#334155',
  },
  reserved: {
    fill: 'var(--color-seat-reserved)',
    stroke: 'none',
    strokeWidth: 0,
    textColor: '#334155',
  },
  held: {
    fill: 'var(--color-seat-held)',
    stroke: 'none',
    strokeWidth: 0,
    textColor: 'white',
  },
};
