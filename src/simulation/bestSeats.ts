import type { Venue } from '../interfaces/venue.interfaces';
import { AVAILABLE, type SeatBook } from './seatBook';

// What a scalper wants and a fan wants first: the best 10% of the seats on sale, by view.
export const BEST_SEAT_SHARE = 0.1;

// Marks the best seats of the venue. "Best" is the same order `findBestSeats` uses for the view
// priority: nearest rows first, then the most central seats in a row (ties by position), so it is
// exactly what a "best view" search hands out first. Only seats that start the sale available count;
// pre-sold and reserved seats were never up for grabs.
export function rankBestSeats(venue: Venue, book: SeatBook, share = BEST_SEAT_SHARE): Uint8Array {
  interface Candidate {
    seat: number;
    row: number;
    offset: number;
  }
  const candidates: Candidate[] = [];

  let seat = 0;
  for (const section of venue.sections) {
    for (const row of section.rows) {
      const first = row.seats[0];
      const last = row.seats.at(-1);
      const centre = first && last ? (first.col + last.col) / 2 : 0;
      for (const s of row.seats) {
        if (book.status[seat] === AVAILABLE) {
          candidates.push({ seat, row: row.index, offset: Math.abs(s.col - centre) });
        }
        seat += 1;
      }
    }
  }

  candidates.sort((a, b) => a.row - b.row || a.offset - b.offset || a.seat - b.seat);
  const best = new Uint8Array(book.seatCount);
  const take = Math.round(candidates.length * share);
  for (let i = 0; i < take; i++) best[candidates[i]?.seat ?? 0] = 1;
  return best;
}
