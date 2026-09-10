export type SeatStatus = 'available' | 'reserved' | 'sold' | 'held';
export interface ISeat {
  id: string;
  col: number;
  x: number;
  y: number;
  priceTier: number;
  status: SeatStatus;
}

export interface Row {
  index: number;
  seats: ISeat[];
}

export interface Section {
  id: string;
  label: string;
  transform: {
    x: number;
    y: number;
    scale: number;
  };
  rows: Row[];
}

export interface Venue {
  venueId: string;
  name: string;
  map: {
    width: number;
    height: number;
  };
  sections: Section[];
}

// --- Live seat-hold contention -------------------------------------------
//
// A seat someone else (another tab, or the seeded demo simulation) is
// currently holding. Only ever holds *other* claims - a tab's own live cart
// is `selectedSeats` + `selectionExpiresAt`, not an entry here - so the
// resolver never has to ask "is this hold mine?".

// Reserved owner id for the seeded demo holds (never a real session id, so
// resolveSeatStatus's "is this my own hold" check can never accidentally
// match it).
export const SIMULATED_OWNER = '__simulation__';

export interface SeatHold {
  seatId: string;
  owner: string;
  expiresAt: number; // epoch ms, in this tab's local clock
}

export type HoldMap = ReadonlyMap<string, SeatHold>;

export type EffectiveSeatStatus = SeatStatus | 'selected';

export interface WireHold {
  seatId: string;
  owner: string;
  expiresAt: number;
}

// `hold` carries an owner's *entire* current hold set, not a delta - a
// deselect/expiry/purchase is just a shorter (or empty) `hold`, so there is
// no separate `release` message and a dropped packet self-heals on the next
// change instead of leaving a stale hold forever.
export type HoldMessage =
  | { type: 'hello'; from: string; sentAt: number; ownedSeatIds: string[] }
  | { type: 'state'; from: string; sentAt: number; to: string; holds: WireHold[] }
  | { type: 'hold'; from: string; sentAt: number; seatIds: string[]; expiresAt: number }
  | { type: 'sold'; from: string; sentAt: number; seatIds: string[] }
  | { type: 'goodbye'; from: string; sentAt: number };
