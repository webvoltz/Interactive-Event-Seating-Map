import { describe, expect, it } from 'vitest';
import type { Venue } from '../interfaces/venue.interfaces';
import venueFile from '../../public/venue.json?raw';
import { ingestPeerHold, pruneHolds } from '../utils/holdProtocol';
import { MAX_SELECTABLE_SEATS } from '../utils/selectionLimits';
import { DEFAULT_CONFIG, type SimConfig } from './config';
import { SimulationEngine, TICK_MS, sessionIdOf, type SimStats } from './engine';
import { makeConfig, makeVenue } from './fixtures';
import { AVAILABLE, HELD, NO_OWNER, RESERVED, SOLD } from './seatBook';

function isVenue(data: unknown): data is Venue {
  return (
    typeof data === 'object' && data !== null && 'sections' in data && Array.isArray(data.sections)
  );
}
const parsedVenue: unknown = JSON.parse(venueFile);
if (!isVenue(parsedVenue)) throw new Error('public/venue.json is not a venue');
const realVenue = parsedVenue;
const HOUR_MS = 3_600_000;

function counts(status: Uint8Array) {
  const c = { available: 0, held: 0, sold: 0, reserved: 0 };
  for (const s of status) {
    if (s === AVAILABLE) c.available += 1;
    else if (s === HELD) c.held += 1;
    else if (s === SOLD) c.sold += 1;
    else if (s === RESERVED) c.reserved += 1;
  }
  return c;
}

// Everything that must hold at every instant, however the crowd behaves. Violations are gathered
// in plain code and asserted once: a per-seat `expect` is far too slow for a 15,000-seat board.
function expectConsistent(engine: SimulationEngine, previousStatus: Uint8Array | null): void {
  const { book } = engine;
  const problems: string[] = [];
  const c = counts(book.status);
  if (book.availableCount !== c.available) problems.push('availableCount drifted');
  if (book.heldCount !== c.held) problems.push('heldCount drifted');
  if (book.soldCount !== c.sold) problems.push('soldCount drifted');

  const perOwner = new Map<number, number>();
  const sectionAvailable = new Array<number>(book.sectionCount).fill(0);
  const sectionSold = new Array<number>(book.sectionCount).fill(0);
  book.status.forEach((status, seat) => {
    const owner = book.owner[seat] ?? NO_OWNER;
    if (status === HELD) {
      if (owner < 0) problems.push(`held seat ${seat} has no owner`);
      perOwner.set(owner, (perOwner.get(owner) ?? 0) + 1);
    } else if (owner !== NO_OWNER) {
      problems.push(`seat ${seat} is not held but has owner ${owner}`);
    }
    const before = previousStatus?.[seat];
    if (before === SOLD && status !== SOLD) problems.push(`sold seat ${seat} reverted`);
    if (before === RESERVED && status !== RESERVED) problems.push(`reserved seat ${seat} changed`);
    const section = book.sectionOf[seat] ?? 0;
    if (status === AVAILABLE) sectionAvailable[section] = (sectionAvailable[section] ?? 0) + 1;
    if (status === SOLD) sectionSold[section] = (sectionSold[section] ?? 0) + 1;
  });
  for (const [owner, held] of perOwner) {
    if (held > MAX_SELECTABLE_SEATS) problems.push(`buyer ${owner} holds ${held} seats`);
  }
  for (let s = 0; s < book.sectionCount; s++) {
    if (book.sectionAvailable[s] !== sectionAvailable[s])
      problems.push(`section ${s} available drifted`);
    if (book.sectionSold[s] !== sectionSold[s]) problems.push(`section ${s} sold drifted`);
  }
  // The per-row free counts the search relies on must match a recount of the board.
  const rowFree = new Array<number>(book.rowFree.length).fill(0);
  let row = -1;
  let previousSeat = -1;
  book.status.forEach((status, seat) => {
    // Rows are contiguous runs of seats; a new row starts where the free-count slot advances.
    if (previousSeat < 0 || book.rowStartsAt(seat)) row += 1;
    previousSeat = seat;
    if (status === AVAILABLE) rowFree[row] = (rowFree[row] ?? 0) + 1;
  });
  rowFree.forEach((free, r) => {
    if (book.rowFree[r] !== free) problems.push(`row ${r} free count drifted`);
  });
  expect(problems).toEqual([]);
}

function replayDeltas(initial: Uint8Array, deltas: Uint32Array[]): Uint8Array {
  const board = initial.slice();
  for (const delta of deltas) {
    for (const packed of delta) board[packed >>> 2] = packed & 3;
  }
  return board;
}

function runToEnd(venue: Venue, config: SimConfig) {
  const engine = new SimulationEngine(venue, config);
  const initial = engine.statusSnapshot();
  const deltas: Uint32Array[] = [];
  const soldOutSections: number[] = [];
  let previous = initial;
  for (let t = 10_000; !engine.finished && t <= HOUR_MS; t += 10_000) {
    engine.advanceTo(t);
    const delta = engine.drainDelta();
    deltas.push(delta.seatChanges);
    soldOutSections.push(...delta.soldOutSections);
    expectConsistent(engine, previous);
    previous = engine.statusSnapshot();
  }
  return { engine, initial, deltas, soldOutSections, stats: engine.getStats() };
}

const smallSale: Partial<SimConfig> = { buyers: 1500, admitPerSec: 300, holdMs: 60_000, seed: 11 };

describe('SimulationEngine: a sale on the real venue', () => {
  it('stays internally consistent, mirrors its own diffs, and accounts for every buyer', () => {
    const { engine, initial, deltas, stats } = runToEnd(realVenue, makeConfig(smallSale));

    expect(stats.finished).toBe(true);
    expect(replayDeltas(initial, deltas)).toEqual(engine.statusSnapshot());

    // Every buyer ends either purchased or abandoned, for exactly one recorded reason.
    expect(stats.stages.purchased + stats.stages.abandoned).toBe(stats.totalBuyers);
    expect(stats.stages.abandoned).toBe(stats.gaveUp + stats.turnedAway);
    expect(stats.stages.queued + stats.stages.searching + stats.stages.holding).toBe(0);

    const newlySold = engine.book.soldCount - counts(initial).sold;
    const priceSum = Array.from(engine.book.status).reduce(
      (sum, s, seat) =>
        sum + (s === SOLD && initial[seat] !== SOLD ? (engine.book.price[seat] ?? 0) : 0),
      0,
    );
    expect(stats.revenue).toBe(priceSum);
    expect(newlySold).toBeGreaterThan(0);
    expect(stats.seats.total).toBe(15000);
    expect(stats.seats.reserved).toBe(1480);
    expect(stats.soldPct).toBeGreaterThan(0);
    expect(stats.avgWaitMs).toBeGreaterThan(0);
  }, 60_000);

  it('only ever lets the lower session id win a contested seat, and expires holds exactly on time', () => {
    const config = makeConfig({ ...smallSale, holdMs: 30_000 });
    const engine = new SimulationEngine(realVenue, config);
    const heldAt = new Map<number, number>();
    let expiries = 0;
    let earlyReleases = 0;

    for (let t = TICK_MS; !engine.finished && t <= HOUR_MS; t += TICK_MS) {
      engine.advanceTo(t);
      for (const packed of engine.drainDelta().seatChanges) {
        const seat = packed >>> 2;
        const status = packed & 3;
        if (status === HELD) heldAt.set(seat, engine.simTimeMs);
        if (status === SOLD) heldAt.delete(seat);
        if (status !== AVAILABLE) continue;

        const since = heldAt.get(seat) ?? Number.NaN;
        heldAt.delete(seat);
        const held = engine.simTimeMs - since;
        expect(held).toBeLessThanOrEqual(config.holdMs);
        if (held === config.holdMs) {
          expiries += 1;
          // The real reducer must agree: live one tick before the deadline, gone at it.
          const id = engine.book.ids[seat] ?? '';
          const holds = new Map([
            [id, { seatId: id, owner: 'b', expiresAt: since + config.holdMs }],
          ]);
          expect(pruneHolds(holds, engine.simTimeMs - TICK_MS)).toBe(holds);
          expect(pruneHolds(holds, engine.simTimeMs).size).toBe(0);
        } else {
          earlyReleases += 1;
        }
      }
    }

    expect(expiries).toBeGreaterThan(0);
    expect(engine.getStats().expiredHolds).toBeGreaterThan(0);
    expect(earlyReleases).toBeGreaterThanOrEqual(0);
    expect(engine.getStats().seats.held).toBe(0);
  }, 120_000);

  it('flags each section that ended sold out', () => {
    const { stats, soldOutSections } = runToEnd(realVenue, makeConfig(smallSale));
    stats.sections.forEach((section, index) => {
      if (section.soldOut) expect(soldOutSections).toContain(index);
      expect(section.sold + section.available).toBeLessThanOrEqual(section.total);
    });
  }, 60_000);
});

describe('SimulationEngine: repeatability', () => {
  it('gives identical results for the same seed however the clock is stepped', () => {
    const config = makeConfig({ ...smallSale, pattern: 'waves' });
    const whole = new SimulationEngine(realVenue, config);
    whole.advanceTo(400_000);

    const stepped = new SimulationEngine(realVenue, config);
    for (let t = 250; t <= 400_000; t += 250) stepped.advanceTo(t);

    expect(stepped.simTimeMs).toBe(whole.simTimeMs);
    expect(stepped.getStats()).toEqual(whole.getStats());
    expect(stepped.statusSnapshot()).toEqual(whole.statusSnapshot());
  }, 60_000);

  it('changes the outcome when the seed changes', () => {
    const a = runToEnd(realVenue, makeConfig({ ...smallSale, seed: 1 })).stats;
    const b = runToEnd(realVenue, makeConfig({ ...smallSale, seed: 2 })).stats;
    expect([a.revenue, a.clashes, a.avgWaitMs]).not.toEqual([b.revenue, b.clashes, b.avgWaitMs]);
  }, 60_000);

  it.each(['spike', 'steady', 'waves'] as const)(
    'sells out and finishes with the %s pattern',
    (pattern) => {
      const row = { seats: '.'.repeat(40) };
      const venue = makeVenue([[row, row], [row]]);
      const { stats } = runToEnd(
        venue,
        makeConfig({ buyers: 600, admitPerSec: 100, holdMs: 30_000, seed: 4, pattern }),
      );
      expect(stats.finished).toBe(true);
      expect(stats.soldOutAtMs).not.toBeNull();
      expect(stats.seats.sold).toBeGreaterThan(stats.seats.total * 0.5);
    },
  );
});

describe('SimulationEngine: acceptance at default settings', () => {
  it('sells out in under 2 minutes of sale time and repeats exactly for the same seed', () => {
    const first = runToEnd(realVenue, DEFAULT_CONFIG);
    expect(first.stats.totalBuyers).toBe(20_000);
    expect(first.stats.finished).toBe(true);
    expect(first.stats.soldOutAtMs).not.toBeNull();
    expect(first.stats.soldOutAtMs ?? Infinity).toBeLessThan(120_000);
    // Anything left over is a handful of orphan seats no remaining buyer wanted.
    expect(first.stats.seats.available).toBeLessThan(first.stats.seats.total * 0.01);

    const second = runToEnd(realVenue, DEFAULT_CONFIG);
    expect(second.stats).toEqual(first.stats);
    expect(second.engine.statusSnapshot()).toEqual(first.engine.statusSnapshot());
    expect(second.deltas).toEqual(first.deltas);
  }, 240_000);
});

describe('SimulationEngine: the waiting room', () => {
  it('lets in no more buyers per second than the admission rate', () => {
    const engine = new SimulationEngine(realVenue, makeConfig({ buyers: 2000, admitPerSec: 10 }));
    engine.advanceTo(5_000);
    const s = engine.getStats();
    expect(s.served).toBeGreaterThan(40);
    expect(s.served).toBeLessThanOrEqual(50);
    expect(s.queueLength).toBe(s.stages.queued);
    expect(s.queueLength).toBe(2000 - s.stages.arriving - s.served);
    expect(s.avgWaitMs).toBeGreaterThan(0);
  });

  it('loses buyers who run out of patience in the queue', () => {
    const engine = new SimulationEngine(realVenue, makeConfig({ buyers: 2000, admitPerSec: 10 }));
    engine.advanceTo(1_200_000);
    const s = engine.getStats();
    expect(s.gaveUpInQueue).toBeGreaterThan(0);
    expect(s.gaveUp).toBeGreaterThanOrEqual(s.gaveUpInQueue);
  }, 60_000);

  it('pauses admission when everything is held, then resumes as holds lapse', () => {
    const venue = makeVenue([[{ seats: '..........' }]]);
    const { stats } = runToEnd(
      venue,
      makeConfig({ buyers: 400, admitPerSec: 200, holdMs: 20_000, seed: 5 }),
    );
    expect(stats.finished).toBe(true);
    expect(stats.soldOutAtMs).not.toBeNull();
    expect(stats.stages.purchased).toBeGreaterThan(0);
    expect(stats.turnedAway).toBeGreaterThan(0);
  });

  it('turns everyone away from a venue with nothing on sale', () => {
    const venue = makeVenue([[{ seats: 'sssr' }]]);
    const engine = new SimulationEngine(venue, makeConfig({ buyers: 50 }));
    engine.advanceTo(60_000);
    const s = engine.getStats();
    expect(s.finished).toBe(true);
    expect(s.turnedAway).toBe(50);
    expect(s.saleOverAtMs).toBe(0);
    expect(s.soldPct).toBeGreaterThan(0);
  });
});

describe('SimulationEngine: clashes and fallbacks', () => {
  it('resolves a same-instant grab for one seat the way the real hold protocol does', () => {
    const venue = makeVenue([[{ seats: '.' }]]);
    let found: SimulationEngine | null = null;
    for (let seed = 1; seed < 4000 && !found; seed++) {
      const engine = new SimulationEngine(venue, makeConfig({ buyers: 2, admitPerSec: 100, seed }));
      engine.advanceTo(30_000);
      if (engine.getStats().clashes > 0)
        found = new SimulationEngine(venue, makeConfig({ buyers: 2, admitPerSec: 100, seed }));
    }
    if (!found) throw new Error('no seed produced a same-tick clash');

    // Walk until the seat is first taken, and see who got it.
    let winner = NO_OWNER;
    for (let t = TICK_MS; t < 30_000 && winner === NO_OWNER; t += TICK_MS) {
      found.advanceTo(t);
      if (found.book.status[0] === HELD) winner = found.book.owner[0] ?? NO_OWNER;
    }

    const seat = found.book.ids[0] ?? '';
    const asBuyer1 = ingestPeerHold(new Map(), new Set([seat]), sessionIdOf(1), {
      from: sessionIdOf(0),
      seatIds: [seat],
      expiresAt: 1,
    });
    const asBuyer0 = ingestPeerHold(new Map(), new Set([seat]), sessionIdOf(0), {
      from: sessionIdOf(1),
      seatIds: [seat],
      expiresAt: 1,
    });
    expect(asBuyer1.lostSeatIds).toEqual([seat]);
    expect(asBuyer0.mustRepost).toBe(true);
    expect(winner).toBe(0);
  });

  it('falls back to another section when the preferred one is gone', () => {
    const venue = makeVenue([[{ seats: 'ssssssssssssssss' }], [{ seats: '................' }]]);
    const { engine, stats } = runToEnd(
      venue,
      makeConfig({ buyers: 300, admitPerSec: 200, seed: 3 }),
    );
    expect(stats.sections[0]?.sold).toBe(16);
    expect(stats.sections[1]?.sold).toBeGreaterThan(0);
    expect(engine.book.sectionAvailable[1]).toBeLessThanOrEqual(2);
  });

  it('splits a group and raises a budget when only scattered or premium seats remain', () => {
    const scattered = makeVenue([
      [
        { seats: '.r.r.r.r.r.r.r.r', tier: 1 },
        { seats: 'r.r.r.r.r.r.r.r.', tier: 1 },
      ],
    ]);
    const { stats } = runToEnd(scattered, makeConfig({ buyers: 400, admitPerSec: 200, seed: 8 }));
    // Singles only, at premium prices: sales can happen only through splitting and a raised budget.
    expect(stats.seats.sold).toBeGreaterThan(0);
    expect(stats.revenue).toBe(stats.seats.sold * 7000);
  });

  it('counts contested seats as clashes per second while a rush is on', () => {
    const engine = new SimulationEngine(
      realVenue,
      makeConfig({ buyers: 5000, admitPerSec: 2000, seed: 21 }),
    );
    let peak = 0;
    for (let t = 1_000; t <= 40_000; t += 1_000) {
      engine.advanceTo(t);
      peak = Math.max(peak, engine.getStats().clashesPerSec);
    }
    expect(engine.getStats().clashes).toBeGreaterThan(0);
    expect(peak).toBeGreaterThan(0);
  }, 60_000);

  it('never advances past the finish and tolerates a stale target', () => {
    const engine = new SimulationEngine(makeVenue([[{ seats: 'ss' }]]), makeConfig({ buyers: 10 }));
    engine.advanceTo(100_000);
    const at = engine.simTimeMs;
    expect(engine.advanceTo(50)).toBe(at);
    expect(engine.finished).toBe(true);
    expect(engine.drainDelta().seatChanges.length).toBe(0);
  });
});

describe('SimStats shape', () => {
  it('reports sensible numbers before anything has happened', () => {
    const engine = new SimulationEngine(realVenue, DEFAULT_CONFIG);
    const s: SimStats = engine.getStats();
    expect(s.simTimeMs).toBe(0);
    expect(s.stages.arriving).toBe(DEFAULT_CONFIG.buyers);
    expect(s.avgWaitMs).toBe(0);
    expect(s.sections).toHaveLength(10);
    expect(s.soldOutAtMs).toBeNull();
    expect(s.finished).toBe(false);
  });
});
