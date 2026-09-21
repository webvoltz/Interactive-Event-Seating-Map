import type { EffectiveSeatStatus, HoldMap, ISeat } from '../interfaces/venue.interfaces';

export interface SeatStatusOverlays {
  soldSeats: ReadonlySet<string>;
  holds: HoldMap;
  selectedSeats: ReadonlySet<string>;
  now: number;
  simulationSeeded: boolean;
}

export function resolveSeatStatus(
  seat: Pick<ISeat, 'id' | 'status'>,
  overlays: SeatStatusOverlays,
): EffectiveSeatStatus {
  const { soldSeats, holds, selectedSeats, now, simulationSeeded } = overlays;

  if (seat.status === 'sold' || soldSeats.has(seat.id)) return 'sold';

  // Checked before `selected`: on reload, a persisted selection another tab
  // already claimed must not render as falsely "mine" before reconciliation runs.
  const hold = holds.get(seat.id);
  if (hold && hold.expiresAt > now) return 'held';

  if (selectedSeats.has(seat.id)) return 'selected';

  if (seat.status === 'reserved') return 'reserved';

  // venue.json's `held` is a seeding instruction, not a live fact - only
  // authoritative before seeding runs, or a lapsed hold would revert to held forever.
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

// `available`'s stroke is a fallback; Seat.tsx overrides it per price tier.
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
