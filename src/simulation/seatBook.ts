import type { Venue } from '../interfaces/venue.interfaces';
import { getTier } from '../utils/seatIndex';

export const AVAILABLE = 0;
export const HELD = 1;
export const SOLD = 2;
export const RESERVED = 3;
export type SimSeatStatus = typeof AVAILABLE | typeof HELD | typeof SOLD | typeof RESERVED;

export const NO_OWNER = -1;

// Seat index = position in venue order (section, row, seat). The UI derives the same order,
// so diffs can carry a small integer instead of a string id.
export function buildSeatIdList(venue: Venue): string[] {
  const ids: string[] = [];
  for (const section of venue.sections) {
    for (const row of section.rows) {
      for (const seat of row.seats) ids.push(seat.id);
    }
  }
  return ids;
}

export class SeatBook {
  readonly seatCount: number;
  readonly ids: string[];
  readonly indexById = new Map<string, number>();
  readonly status: Uint8Array;
  readonly owner: Int32Array;
  readonly price: Uint32Array;
  readonly tier: Uint8Array;
  readonly sectionOf: Uint16Array;
  readonly sectionCount: number;
  readonly sectionSeatTotal: Uint32Array;
  readonly sectionAvailable: Uint32Array;
  readonly sectionSold: Uint32Array;
  readonly sectionReserved: Uint32Array;
  private readonly rowOf: Uint32Array;
  private readonly colOf: Uint16Array;
  private readonly sectionStart: Uint32Array;
  private readonly priceLevels: number[];
  private readonly sectionVersion: Uint32Array;
  private readonly runCache: Int32Array;
  private readonly runCacheVersion: Int32Array;
  availableCount = 0;
  soldCount = 0;
  heldCount = 0;

  constructor(venue: Venue) {
    this.ids = buildSeatIdList(venue);
    this.seatCount = this.ids.length;
    this.status = new Uint8Array(this.seatCount);
    this.owner = new Int32Array(this.seatCount).fill(NO_OWNER);
    this.price = new Uint32Array(this.seatCount);
    this.tier = new Uint8Array(this.seatCount);
    this.sectionOf = new Uint16Array(this.seatCount);
    this.sectionCount = venue.sections.length;
    this.sectionSeatTotal = new Uint32Array(this.sectionCount);
    this.sectionAvailable = new Uint32Array(this.sectionCount);
    this.sectionSold = new Uint32Array(this.sectionCount);
    this.sectionReserved = new Uint32Array(this.sectionCount);
    this.rowOf = new Uint32Array(this.seatCount);
    this.colOf = new Uint16Array(this.seatCount);
    this.sectionStart = new Uint32Array(this.sectionCount + 1);
    this.sectionVersion = new Uint32Array(this.sectionCount);

    const prices = new Set<number>();
    let i = 0;
    let rowCounter = 0;
    venue.sections.forEach((section, sectionIndex) => {
      this.sectionStart[sectionIndex] = i;
      for (const row of section.rows) {
        rowCounter += 1;
        for (const seat of row.seats) {
          this.rowOf[i] = rowCounter;
          this.colOf[i] = seat.col;
          prices.add(getTier(seat.priceTier).price);
          this.indexById.set(seat.id, i);
          this.price[i] = getTier(seat.priceTier).price;
          this.tier[i] = seat.priceTier;
          this.sectionOf[i] = sectionIndex;
          this.sectionSeatTotal[sectionIndex] = (this.sectionSeatTotal[sectionIndex] ?? 0) + 1;
          // A venue's pre-sale `held` flag is a seeding hint, not a sale-day fact; on-sale day starts clean.
          if (seat.status === 'sold') {
            this.status[i] = SOLD;
            this.soldCount += 1;
            this.sectionSold[sectionIndex] = (this.sectionSold[sectionIndex] ?? 0) + 1;
          } else if (seat.status === 'reserved') {
            this.status[i] = RESERVED;
            this.sectionReserved[sectionIndex] = (this.sectionReserved[sectionIndex] ?? 0) + 1;
          } else {
            this.status[i] = AVAILABLE;
            this.availableCount += 1;
            this.sectionAvailable[sectionIndex] = (this.sectionAvailable[sectionIndex] ?? 0) + 1;
          }
          i += 1;
        }
      }
    });
    this.sectionStart[this.sectionCount] = i;
    this.priceLevels = [...prices].sort((a, b) => a - b);
    this.runCache = new Int32Array(this.sectionCount * (this.priceLevels.length + 1));
    this.runCacheVersion = new Int32Array(this.runCache.length).fill(-1);
  }

  // Longest run of side-by-side available seats in a section priced at or under `maxPrice`.
  // An upper bound for any party's search there, so a smaller party size can skip the scan outright.
  longestFreeRun(section: number, maxPrice: number): number {
    let level = 0;
    while (level < this.priceLevels.length && (this.priceLevels[level] ?? 0) <= maxPrice)
      level += 1;
    const slot = section * (this.priceLevels.length + 1) + level;
    const version = this.sectionVersion[section] ?? 0;
    if (this.runCacheVersion[slot] === version) return this.runCache[slot] ?? 0;

    let best = 0;
    let run = 0;
    const end = this.sectionStart[section + 1] ?? 0;
    for (let seat = this.sectionStart[section] ?? 0; seat < end; seat++) {
      const usable = this.status[seat] === AVAILABLE && (this.price[seat] ?? 0) <= maxPrice;
      const continues =
        seat > 0 &&
        this.rowOf[seat] === this.rowOf[seat - 1] &&
        this.colOf[seat] === (this.colOf[seat - 1] ?? 0) + 1;
      run = usable ? (continues ? run : 0) + 1 : 0;
      if (run > best) best = run;
    }
    this.runCache[slot] = best;
    this.runCacheVersion[slot] = version;
    return best;
  }

  // Returns false (and changes nothing) unless the seat is on sale.
  hold(seat: number, buyer: number): boolean {
    if (this.status[seat] !== AVAILABLE) return false;
    this.status[seat] = HELD;
    this.owner[seat] = buyer;
    this.availableCount -= 1;
    this.heldCount += 1;
    this.bump(this.sectionAvailable, seat, -1);
    this.touch(seat);
    return true;
  }

  release(seat: number): void {
    if (this.status[seat] !== HELD) return;
    this.status[seat] = AVAILABLE;
    this.owner[seat] = NO_OWNER;
    this.availableCount += 1;
    this.heldCount -= 1;
    this.bump(this.sectionAvailable, seat, 1);
    this.touch(seat);
  }

  sell(seat: number): void {
    if (this.status[seat] !== HELD) return;
    this.status[seat] = SOLD;
    this.owner[seat] = NO_OWNER;
    this.heldCount -= 1;
    this.soldCount += 1;
    this.bump(this.sectionSold, seat, 1);
  }

  private touch(seat: number): void {
    const section = this.sectionOf[seat] ?? 0;
    this.sectionVersion[section] = (this.sectionVersion[section] ?? 0) + 1;
  }

  private bump(counter: Uint32Array, seat: number, delta: number): void {
    const section = this.sectionOf[seat] ?? 0;
    counter[section] = (counter[section] ?? 0) + delta;
  }
}
