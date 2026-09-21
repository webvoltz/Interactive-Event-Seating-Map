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

export const SIMULATED_OWNER = '__simulation__';

export interface SeatHold {
  seatId: string;
  owner: string;
  expiresAt: number;
}

export type HoldMap = ReadonlyMap<string, SeatHold>;

export type EffectiveSeatStatus = SeatStatus | 'selected';

export interface WireHold {
  seatId: string;
  owner: string;
  expiresAt: number;
}

// `hold` carries an owner's entire current set, not a delta - no separate `release` message.
export type HoldMessage =
  | { type: 'hello'; from: string; sentAt: number; ownedSeatIds: string[] }
  | { type: 'state'; from: string; sentAt: number; to: string; holds: WireHold[] }
  | { type: 'hold'; from: string; sentAt: number; seatIds: string[]; expiresAt: number }
  | { type: 'sold'; from: string; sentAt: number; seatIds: string[] }
  | { type: 'goodbye'; from: string; sentAt: number };
