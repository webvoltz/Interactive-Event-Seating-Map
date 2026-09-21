import { describe, expect, it } from 'vitest';
import type { ISeat, Row, Section, Venue } from '../interfaces/venue.interfaces';
import { TIERS } from './seatIndex';
import { compareBlocks, findBestSeats } from './findBestSeats';
import type { BlockRanking } from './findBestSeats';

function makeSeat(col: number, priceTier = 1, status: ISeat['status'] = 'available'): ISeat {
  return { id: `S${col}`, col, x: col, y: 0, priceTier, status };
}

function makeRow(index: number, seats: ISeat[]): Row {
  return { index, seats };
}

function makeVenue(sections: { id: string; label: string; rows: Row[] }[]): Venue {
  const mapped: Section[] = sections.map((s) => ({
    id: s.id,
    label: s.label,
    transform: { x: 0, y: 0, scale: 1 },
    rows: s.rows,
  }));
  return { venueId: 'v', name: 'Venue', map: { width: 100, height: 100 }, sections: mapped };
}

const isAvailable = (seat: ISeat) => seat.status === 'available';

describe('findBestSeats', () => {
  it('finds the only run of exactly partySize seats, in ascending col order', () => {
    const venue = makeVenue([
      {
        id: 'S-1',
        label: 'Section 1',
        rows: [
          makeRow(
            1,
            [1, 2, 3].map((c) => makeSeat(c)),
          ),
        ],
      },
    ]);
    const block = findBestSeats(venue, 3, 'view', isAvailable);
    expect(block?.seatIds).toEqual(['S1', 'S2', 'S3']);
  });

  it('returns null when no run is long enough', () => {
    const venue = makeVenue([
      { id: 'S-1', label: 'Section 1', rows: [makeRow(1, [makeSeat(1), makeSeat(2)])] },
    ]);
    expect(findBestSeats(venue, 3, 'view', isAvailable)).toBeNull();
  });

  it.each(['sold', 'reserved', 'held'] as const)(
    'treats %s seats as unselectable via the injected predicate',
    (status) => {
      const seats = [makeSeat(1), makeSeat(2, 1, status), makeSeat(3), makeSeat(4)];
      const venue = makeVenue([{ id: 'S-1', label: 'Section 1', rows: [makeRow(1, seats)] }]);
      const block = findBestSeats(venue, 2, 'view', isAvailable);
      expect(block?.seatIds).toEqual(['S3', 'S4']);
    },
  );

  it('respects the injected predicate for seats venue.json itself marks available', () => {
    const seats = [makeSeat(1), makeSeat(2), makeSeat(3), makeSeat(4)];
    const soldElsewhere = new Set(['S2']);
    const venue = makeVenue([{ id: 'S-1', label: 'Section 1', rows: [makeRow(1, seats)] }]);
    const block = findBestSeats(
      venue,
      2,
      'view',
      (seat) => isAvailable(seat) && !soldElsewhere.has(seat.id),
    );
    expect(block?.seatIds).toEqual(['S3', 'S4']);
  });

  it('a gap in col breaks contiguity - refuses to span it', () => {
    const seats = [makeSeat(1), makeSeat(2), makeSeat(4), makeSeat(5)];
    const venue = makeVenue([{ id: 'S-1', label: 'Section 1', rows: [makeRow(1, seats)] }]);
    expect(findBestSeats(venue, 3, 'view', isAvailable)).toBeNull();
  });

  it('the same gapped row still finds the smaller in-bounds block', () => {
    const seats = [makeSeat(1), makeSeat(2), makeSeat(4), makeSeat(5)];
    const venue = makeVenue([{ id: 'S-1', label: 'Section 1', rows: [makeRow(1, seats)] }]);
    const block = findBestSeats(venue, 2, 'view', isAvailable);
    expect(block?.seatIds).toEqual(['S1', 'S2']);
  });

  it("'view' prefers the lower row index even when a further row is cheaper and better centred", () => {
    const venue = makeVenue([
      {
        id: 'S-1',
        label: 'Section 1',
        rows: [
          makeRow(
            1,
            [1, 2, 3, 4, 5].map((c) => makeSeat(c, 3)),
          ),
          makeRow(
            2,
            [1, 2, 3, 4, 5].map((c) => makeSeat(c, 1)),
          ),
        ],
      },
    ]);
    const block = findBestSeats(venue, 2, 'view', isAvailable);
    expect(block?.rowIndex).toBe(1);
  });

  it("'price' prefers the cheaper block even when it is further from the stage", () => {
    const venue = makeVenue([
      {
        id: 'S-1',
        label: 'Section 1',
        rows: [
          makeRow(
            1,
            [1, 2, 3, 4, 5].map((c) => makeSeat(c, 1)),
          ),
          makeRow(
            2,
            [1, 2, 3, 4, 5].map((c) => makeSeat(c, 3)),
          ),
        ],
      },
    ]);
    const block = findBestSeats(venue, 2, 'price', isAvailable);
    expect(block?.rowIndex).toBe(2);
    expect(block?.totalPrice).toBe(TIERS[3]?.price ? TIERS[3].price * 2 : 0);
  });

  it("'price' tiebreak: among equally-priced blocks, the lower row index wins", () => {
    const venue = makeVenue([
      {
        id: 'S-1',
        label: 'Section 1',
        rows: [
          makeRow(
            1,
            [1, 2, 3, 4, 5].map((c) => makeSeat(c, 2)),
          ),
          makeRow(
            2,
            [1, 2, 3, 4, 5].map((c) => makeSeat(c, 2)),
          ),
        ],
      },
    ]);
    const block = findBestSeats(venue, 2, 'price', isAvailable);
    expect(block?.rowIndex).toBe(1);
  });

  it("'view' tiebreak within one row: the most centred window wins, not the leftmost", () => {
    const seats = Array.from({ length: 18 }, (_, i) => makeSeat(i + 1));
    const venue = makeVenue([{ id: 'S-1', label: 'Section 1', rows: [makeRow(1, seats)] }]);
    const block = findBestSeats(venue, 4, 'view', isAvailable);
    // Row centre is 9.5; cols 8-11 are centred, not the leftmost window.
    expect(block?.seatIds).toEqual(['S8', 'S9', 'S10', 'S11']);
  });

  it('centring is measured in col space: identical col layouts rank identically regardless of x/y spacing', () => {
    const tightRow = makeRow(
      1,
      [1, 2, 3, 4, 5].map((c) => ({ ...makeSeat(c), x: c * 3.77 })),
    );
    const wideRow = makeRow(
      2,
      [1, 2, 3, 4, 5].map((c) => ({ ...makeSeat(c), x: c * 8.14 })),
    );
    const venueTight = makeVenue([{ id: 'S-1', label: 'Section 1', rows: [tightRow] }]);
    const venueWide = makeVenue([{ id: 'S-1', label: 'Section 1', rows: [wideRow] }]);
    const tightBlock = findBestSeats(venueTight, 3, 'view', isAvailable);
    const wideBlock = findBestSeats(venueWide, 3, 'view', isAvailable);
    expect(tightBlock?.centreOffset).toBe(wideBlock?.centreOffset);
  });

  it('determinism across congruent sections: the lower sectionOrder wins regardless of input order', () => {
    const row = () =>
      makeRow(
        1,
        [1, 2, 3].map((c) => makeSeat(c)),
      );
    const forward = makeVenue([
      { id: 'S-A', label: 'A', rows: [row()] },
      { id: 'S-B', label: 'B', rows: [row()] },
    ]);
    const reversed = makeVenue([
      { id: 'S-B', label: 'B', rows: [row()] },
      { id: 'S-A', label: 'A', rows: [row()] },
    ]);
    expect(findBestSeats(forward, 3, 'view', isAvailable)?.sectionId).toBe('S-A');
    expect(findBestSeats(reversed, 3, 'view', isAvailable)?.sectionId).toBe('S-B');
  });

  it('party size 1 returns a single seat with startCol === endCol', () => {
    const venue = makeVenue([
      { id: 'S-1', label: 'Section 1', rows: [makeRow(1, [makeSeat(1), makeSeat(2)])] },
    ]);
    const block = findBestSeats(venue, 1, 'view', isAvailable);
    expect(block?.startCol).toBe(block?.endCol);
    expect(block?.seatIds).toHaveLength(1);
  });

  it.each([0, -1, 2.5])('rejects an invalid party size (%s) rather than throwing', (partySize) => {
    const venue = makeVenue([
      { id: 'S-1', label: 'Section 1', rows: [makeRow(1, [makeSeat(1), makeSeat(2)])] },
    ]);
    expect(findBestSeats(venue, partySize, 'view', isAvailable)).toBeNull();
  });

  it('an empty venue, a row-less section, and a seat-less row all return null without throwing', () => {
    const empty = makeVenue([]);
    expect(findBestSeats(empty, 2, 'view', isAvailable)).toBeNull();

    const noRows = makeVenue([{ id: 'S-1', label: 'Section 1', rows: [] }]);
    expect(findBestSeats(noRows, 2, 'view', isAvailable)).toBeNull();

    const noSeats = makeVenue([{ id: 'S-1', label: 'Section 1', rows: [makeRow(1, [])] }]);
    expect(findBestSeats(noSeats, 2, 'view', isAvailable)).toBeNull();
  });

  it('sums real per-seat prices rather than assuming a uniform tier across the block', () => {
    const seats = [makeSeat(1, 1), makeSeat(2, 1), makeSeat(3, 3)];
    const venue = makeVenue([{ id: 'S-1', label: 'Section 1', rows: [makeRow(1, seats)] }]);
    const block = findBestSeats(venue, 3, 'view', isAvailable);
    const tier1 = TIERS[1]?.price ?? 0;
    const tier3 = TIERS[3]?.price ?? 0;
    expect(block?.totalPrice).toBe(tier1 * 2 + tier3);
  });

  it('skips a row shorter than partySize and still finds a later valid row', () => {
    const venue = makeVenue([
      {
        id: 'S-1',
        label: 'Section 1',
        rows: [makeRow(1, [makeSeat(1)]), makeRow(2, [makeSeat(1), makeSeat(2), makeSeat(3)])],
      },
    ]);
    const block = findBestSeats(venue, 3, 'view', isAvailable);
    expect(block?.rowIndex).toBe(2);
  });
});

describe('compareBlocks', () => {
  const base: BlockRanking = {
    rowIndex: 1,
    totalPrice: 100,
    centreOffset: 0,
    sectionOrder: 0,
    startCol: 1,
  };

  it('is antisymmetric and zero only for identical rankings, for both priorities', () => {
    const variants: BlockRanking[] = [
      base,
      { ...base, rowIndex: 2 },
      { ...base, totalPrice: 50 },
      { ...base, centreOffset: 3 },
      { ...base, sectionOrder: 1 },
      { ...base, startCol: 5 },
    ];

    // Summing signs (not negating) avoids +0 vs -0 mismatching under `.toBe`.
    (['view', 'price'] as const).forEach((priority) => {
      for (const a of variants) {
        for (const b of variants) {
          const cmp = compareBlocks(a, b, priority);
          const rev = compareBlocks(b, a, priority);
          expect(Math.sign(cmp) + Math.sign(rev)).toBe(0);
          if (a === b) expect(cmp).toBe(0);
        }
      }
    });
  });
});
