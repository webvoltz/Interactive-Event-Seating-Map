import type { ISeat, Venue } from '../interfaces/venue.interfaces';
import { getTier } from './seatIndex';
import { rowLetter } from './rowLetter';

export type SeatPriority = 'view' | 'price';

export type IsSeatSelectable = (seat: ISeat) => boolean;

export interface BlockRanking {
  rowIndex: number;
  totalPrice: number;
  // Col-space, not x/y: col maps linearly onto arc angle, so this is angular centring.
  centreOffset: number;
  sectionOrder: number;
  startCol: number;
}

export interface SeatBlock extends BlockRanking {
  seatIds: string[];
  sectionId: string;
  sectionLabel: string;
  rowLabel: string;
  endCol: number;
}

// (sectionOrder, rowIndex, startCol) is unique per candidate, so this is a strict total order.
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
