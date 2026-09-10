import type { ISeat, Venue } from '../interfaces/venue.interfaces';
import { getTier } from './seatIndex';
import { rowLetter } from './rowLetter';

export type SeatPriority = 'view' | 'price';

// Injected rather than read from the store, so the solver stays a pure
// function testable without Zustand - the caller composes this from
// venue.json status plus session-local state (soldSeats, holds, ...).
export type IsSeatSelectable = (seat: ISeat) => boolean;

// Every field is a number sorted ascending, which is what lets compareBlocks
// be driven by a key list instead of per-priority branching.
export interface BlockRanking {
  rowIndex: number; // Row.index (1-based); lower = smaller radius = closer to the stage
  totalPrice: number;
  // |block col-centre - row col-centre|, in col units - not x/y. Every seat
  // in a row sits on the same arc at the same radius and col maps linearly
  // onto angle (see generateVenue.ts), so col-centring *is* angular
  // centring. x/y centring would distort the comparison: arc length per
  // seat grows with radius, so an x/y offset for the same col displacement
  // is larger in an outer row than an identical inner-row one for no
  // ticketing-relevant reason.
  centreOffset: number;
  sectionOrder: number; // index into venue.sections - a tiebreaker, not a rank
  startCol: number; // a tiebreaker, not a rank
}

export interface SeatBlock extends BlockRanking {
  seatIds: string[]; // ascending col order
  sectionId: string;
  sectionLabel: string;
  rowLabel: string;
  endCol: number;
}

// (sectionOrder, rowIndex, startCol) uniquely identifies a candidate block,
// and both orders end in (sectionOrder, startCol) after their priority-
// specific keys - so compareBlocks returns 0 only when comparing a block
// with itself. That strict total order is what makes "best available" mean
// the same seat on every call, rather than depending on venue.sections'
// array order.
const RANKING_KEYS: Record<SeatPriority, readonly (keyof BlockRanking)[]> = {
  view: ['rowIndex', 'centreOffset', 'totalPrice', 'sectionOrder', 'startCol'],
  price: ['totalPrice', 'rowIndex', 'centreOffset', 'sectionOrder', 'startCol'],
};

export function compareBlocks(a: BlockRanking, b: BlockRanking, priority: SeatPriority): number {
  for (const key of RANKING_KEYS[priority]) {
    const diff = a[key] - b[key];
    if (diff !== 0) return diff;
  }
  return 0;
}

interface BestSoFar {
  ranking: BlockRanking;
  sectionId: string;
  sectionLabel: string;
  rowIndex: number;
  seats: ISeat[];
}

// One left-to-right pass per row, sliding a window of exactly `partySize`
// selectable seats. Every window is scored (not just one per run) because
// the most central window in a long run usually isn't the leftmost one.
function scoreRow(
  row: { index: number; seats: ISeat[] },
  section: { id: string; label: string },
  sectionOrder: number,
  partySize: number,
  priority: SeatPriority,
  isSelectable: IsSeatSelectable,
  best: BestSoFar | null,
): BestSoFar | null {
  const [first] = row.seats;
  const last = row.seats.at(-1);
  if (!first || !last) return best;
  const rowCentre = (first.col + last.col) / 2;

  let prev: ISeat | undefined;
  let window: ISeat[] = [];
  let updated = best;

  for (const seat of row.seats) {
    const selectable = isSelectable(seat);
    // A gap in `col` breaks contiguity even if both sides are selectable -
    // this is what makes an aisle (or any missing seat) a real boundary
    // rather than "adjacent in the array".
    const brokenRun = !selectable || (prev !== undefined && seat.col !== prev.col + 1);
    if (brokenRun) window = [];
    if (selectable) {
      window.push(seat);
      if (window.length > partySize) window.shift();

      if (window.length === partySize) {
        const [windowFirst] = window;
        const windowLast = window.at(-1);
        if (windowFirst && windowLast) {
          let totalPrice = 0;
          for (const s of window) totalPrice += getTier(s.priceTier).price;
          const blockCentre = (windowFirst.col + windowLast.col) / 2;

          const ranking: BlockRanking = {
            rowIndex: row.index,
            totalPrice,
            centreOffset: Math.abs(blockCentre - rowCentre),
            sectionOrder,
            startCol: windowFirst.col,
          };

          if (!updated || compareBlocks(ranking, updated.ranking, priority) < 0) {
            updated = {
              ranking,
              sectionId: section.id,
              sectionLabel: section.label,
              rowIndex: row.index,
              seats: [...window],
            };
          }
        }
      }
    }
    prev = seat;
  }

  return updated;
}

// Finds the single best contiguous block of `partySize` selectable seats in
// the venue, per `priority`. O(total seats * partySize): partySize is
// capped at MAX_SELECTABLE_SEATS by the caller, so this is a few hundred
// thousand elementary operations at most - single-digit milliseconds for a
// user-initiated search, not something that needs memoising or debouncing.
export function findBestSeats(
  venue: Venue,
  partySize: number,
  priority: SeatPriority,
  isSelectable: IsSeatSelectable,
): SeatBlock | null {
  if (!Number.isInteger(partySize) || partySize < 1) return null;

  let best: BestSoFar | null = null;
  let sectionOrder = 0;
  for (const section of venue.sections) {
    for (const row of section.rows) {
      best = scoreRow(row, section, sectionOrder, partySize, priority, isSelectable, best);
    }
    sectionOrder += 1;
  }

  if (!best) return null;
  const { ranking, sectionId, sectionLabel, rowIndex, seats } = best;
  const [firstSeat] = seats;
  const lastSeat = seats.at(-1);
  // Unreachable in practice (a BestSoFar is only ever built from a
  // `partySize`-length window, so `seats` is never empty) - guarded rather
  // than asserted to satisfy noUncheckedIndexedAccess without a `!`.
  if (!firstSeat || !lastSeat) return null;

  return {
    ...ranking,
    seatIds: seats.map((s) => s.id),
    sectionId,
    sectionLabel,
    rowLabel: rowLetter(rowIndex - 1),
    endCol: lastSeat.col,
  };
}
