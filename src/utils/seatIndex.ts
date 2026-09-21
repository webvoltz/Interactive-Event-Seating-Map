import type { Venue } from '../interfaces/venue.interfaces';
import { rowLetter } from './rowLetter';

export const TIERS: Record<number, { name: string; price: number }> = {
  1: { name: 'Premium Stand', price: 7000 },
  2: { name: 'Standard Stand', price: 3000 },
  3: { name: 'Gallery Stand', price: 1500 },
};
const DEFAULT_TIER = { name: 'Standard Ticket', price: 50 };
export const getTier = (tier: number) => TIERS[tier] ?? DEFAULT_TIER;

export interface SeatIndexEntry {
  sectionId: string;
  sectionLabel: string;
  rowLabel: string;
  seatCol: number;
  tierName: string;
  price: number;
}

// One shared seatId -> details lookup, built once per venue, so the
// selection panel and booking history never independently re-derive (and
// risk drifting on) the same row/tier/price data.
export function buildSeatIndex(venue: Venue): Map<string, SeatIndexEntry> {
  const index = new Map<string, SeatIndexEntry>();
  venue.sections.forEach((section) => {
    section.rows.forEach((row) => {
      row.seats.forEach((seat) => {
        const tier = getTier(seat.priceTier);
        index.set(seat.id, {
          sectionId: section.id,
          sectionLabel: section.label,
          rowLabel: rowLetter(row.index - 1),
          seatCol: seat.col,
          tierName: tier.name,
          price: tier.price,
        });
      });
    });
  });
  return index;
}
