import { describe, expect, it } from 'vitest';
import { rankBestSeats } from './bestSeats';
import { DEFAULT_CONFIG } from './config';
import { compareDetection, outcomeOf, runSale } from './comparison';
import { DETECTION, IdentityTracker, countSignals } from './detection';
import { SimulationEngine, TICK_MS } from './engine';
import { makeConfig, makeVenue } from './fixtures';
import { realVenue } from './realVenue';
import { AVAILABLE, HELD, SeatBook, SOLD } from './seatBook';

describe('detection rules', () => {
  it('flags speed only after repeated machine-fast actions', () => {
    const t = new IdentityTracker(3);
    // Admitted at 1000: a search 80 ms later is fast, but one such action is not a pattern.
    t.noteAction(0, 1080, 4, 1000);
    expect(t.signals(0).speed).toBe(false);
    t.noteAction(0, 1180, 4, 1000);
    expect(t.signals(0).speed).toBe(true);

    // A person looks at the map for a while first.
    t.noteAction(1, 1900, 2, 1000);
    t.noteAction(1, 3000, 2, 1000);
    expect(t.signals(1).speed).toBe(false);
  });

  it('flags an identity holding more than one booking, and only more than one', () => {
    const t = new IdentityTracker(1);
    t.addSeats(0, DETECTION.MAX_SEATS_PER_IDENTITY);
    expect(t.signals(0).seats).toBe(false);
    t.addSeats(0, 1);
    expect(t.signals(0).seats).toBe(true);
  });

  it('flags the same request repeated quickly, and resets when the shape or the pace changes', () => {
    const t = new IdentityTracker(1);
    t.noteAction(0, 1000, 6, 0);
    t.noteAction(0, 1500, 6, 0);
    expect(t.signals(0).pattern).toBe(false);
    t.noteAction(0, 2000, 6, 0);
    expect(t.signals(0).pattern).toBe(true);

    t.noteAction(0, 2500, 3, 0);
    expect(t.signals(0).pattern).toBe(false);
    t.noteAction(0, 2900, 3, 0);
    t.noteAction(0, 9000, 3, 0);
    expect(t.signals(0).pattern).toBe(false);
  });

  it('hands over each acted-on identity once per sweep', () => {
    const t = new IdentityTracker(5);
    t.noteAction(2, 100, 1, 0);
    t.noteAction(2, 700, 1, 0);
    t.addSeats(4, 2);
    expect(t.takeDirty()).toEqual([2, 4]);
    expect(t.takeDirty()).toEqual([]);
    t.addSeats(2, 1);
    expect(t.takeDirty()).toEqual([2]);
  });

  it('counts how many rules agree', () => {
    expect(countSignals({ speed: false, seats: false, pattern: false })).toBe(0);
    expect(countSignals({ speed: true, seats: false, pattern: true })).toBe(2);
    expect(countSignals({ speed: true, seats: true, pattern: true })).toBe(3);
  });
});

describe('rankBestSeats', () => {
  it('marks the closest rows and most central seats first, leaving out seats never on sale', () => {
    const venue = makeVenue([[{ seats: '.....' }, { seats: 's.r..' }, { seats: '.....' }]]);
    const book = new SeatBook(venue);
    const best = rankBestSeats(venue, book, 0.4);
    // 13 seats on sale (15 - 1 sold - 1 reserved); 40% of them = 5, taken nearest-row-first.
    const marked = Array.from(best).reduce((n, flag) => n + flag, 0);
    expect(marked).toBe(5);
    // Row 1's five seats are the first five in order of (row, distance from centre).
    expect(Array.from(best.subarray(0, 5))).toEqual([1, 1, 1, 1, 1]);
    expect(best[5]).toBe(0);
    expect(best[7]).toBe(0);
  });

  it('is the real venue’s front-and-centre tenth', () => {
    const book = new SeatBook(realVenue);
    const best = rankBestSeats(realVenue, book);
    const marked = Array.from(best).reduce((n, flag) => n + flag, 0);
    expect(marked).toBe(Math.round(book.availableCount * 0.1));
  });
});

const crowd = makeConfig({ buyers: 5_000, admitPerSec: 400, seed: 5 });

describe('scalper bots in a sale', () => {
  it('leaves a sale with no bots untouched by the detector', () => {
    const off = runSale(realVenue, { ...crowd, bots: 0, detection: false });
    const on = runSale(realVenue, { ...crowd, bots: 0, detection: true });
    expect({ ...on, detection: false, blockedBy: off.blockedBy }).toEqual(off);
    expect(on.humansBlocked).toBe(0);
    expect(on.fanShare).toBe(100);
  }, 60_000);

  it('arrives in the first moments of the sale and is let in ahead of most of the crowd', () => {
    const engine = new SimulationEngine(realVenue, { ...crowd, bots: 100 });
    engine.advanceTo(1_000);
    const early = engine.getStats();
    // Most of the 100 are in within a second, while only a few hundred of 5,000 people have been.
    expect(early.bots.admitted).toBeGreaterThan(50);
    expect(early.served).toBeLessThan(400);

    engine.advanceTo(5_000);
    const later = engine.getStats();
    expect(later.bots.admitted).toBe(100);
    // Bots are not crowd buyers: they never count as served, and the crowd total is unchanged.
    expect(later.totalBuyers).toBe(5_000);
    expect(
      later.stages.arriving + later.stages.queued + later.stages.searching,
    ).toBeLessThanOrEqual(5_000);
  });

  it('takes a big share of the best seats when nothing stops it', () => {
    const outcome = runSale(realVenue, { ...crowd, bots: 200, detection: false });
    expect(outcome.botSeatsSold).toBeGreaterThan(1_000);
    expect(outcome.bestToBots).toBeGreaterThan(outcome.bestSeatsTotal * 0.3);
    expect(outcome.fanShare).toBeLessThan(70);
    expect(outcome.botsBlocked).toBe(0);
    expect(outcome.bestToFans + outcome.bestToBots).toBeLessThanOrEqual(outcome.bestSeatsTotal);
  }, 60_000);

  it('is mostly stopped by the detector, without ever blocking a real buyer', () => {
    const off = runSale(realVenue, { ...crowd, bots: 200, detection: false });
    const on = runSale(realVenue, { ...crowd, bots: 200, detection: true });
    expect(on.botsBlocked).toBeGreaterThanOrEqual(190);
    expect(on.humansBlocked).toBe(0);
    expect(on.botSeatsSold).toBeLessThan(off.botSeatsSold * 0.1);
    expect(on.fanShare).toBeGreaterThan(90);
    expect(on.fanShare).toBeGreaterThan(off.fanShare + 20);
    // Each blocked bot was caught by at least two rules agreeing.
    const firings = on.blockedBy.speed + on.blockedBy.seats + on.blockedBy.pattern;
    expect(firings).toBeGreaterThanOrEqual(on.botsBlocked * DETECTION.RULES_TO_BLOCK);
  }, 60_000);

  it('gives back what a blocked bot held but never paid for', () => {
    const engine = new SimulationEngine(realVenue, { ...crowd, bots: 200, detection: true });
    engine.advanceTo(3_600_000);
    const { bots } = engine.getStats();
    expect(bots.seatsHeld).toBeGreaterThan(bots.seatsSold);
    expect(engine.book.heldCount).toBe(0);
  }, 60_000);

  it('repeats exactly for the same seed, including the event stream', () => {
    const run = () => {
      const engine = new SimulationEngine(realVenue, { ...crowd, bots: 100, detection: true });
      const deltas: Uint32Array[] = [];
      for (let t = 10_000; !engine.finished && t < 3_600_000; t += 10_000) {
        engine.advanceTo(t);
        deltas.push(engine.drainDelta().seatChanges);
      }
      return { stats: engine.getStats(), deltas, board: engine.statusSnapshot() };
    };
    const a = run();
    const b = run();
    expect(b.stats).toEqual(a.stats);
    expect(b.board).toEqual(a.board);
    expect(b.deltas).toEqual(a.deltas);
  }, 60_000);

  it('keeps the books balanced, with bots holding more than one booking at a time', () => {
    const engine = new SimulationEngine(realVenue, { ...crowd, bots: 150, detection: false });
    let previous = engine.statusSnapshot();
    for (let t = 5_000; !engine.finished && t < 3_600_000; t += 5_000) {
      engine.advanceTo(t);
      const { status } = engine.book;
      let sold = 0;
      let held = 0;
      let available = 0;
      const problems: string[] = [];
      status.forEach((s, seat) => {
        if (s === SOLD) sold += 1;
        if (s === HELD) held += 1;
        if (s === AVAILABLE) available += 1;
        if (previous[seat] === SOLD && s !== SOLD) problems.push(`sold seat ${seat} reverted`);
      });
      if (sold !== engine.book.soldCount) problems.push('sold count drifted');
      if (held !== engine.book.heldCount) problems.push('held count drifted');
      if (available !== engine.book.availableCount) problems.push('available count drifted');
      expect(problems).toEqual([]);
      previous = engine.statusSnapshot();
    }
    const stats = engine.getStats();
    expect(stats.stages.purchased + stats.stages.abandoned).toBe(stats.totalBuyers);
    expect(stats.bots.seatsSold).toBeGreaterThan(0);
  }, 60_000);

  it('lets the viewer still play, with their identity placed after the bots', () => {
    const engine = new SimulationEngine(realVenue, { ...crowd, bots: 50 });
    engine.advanceTo(2_000);
    engine.joinViewer();
    for (let t = 2_000; engine.getViewerState().stage === 'queued' && t < 300_000; t += 500)
      engine.advanceTo(t);
    expect(engine.getViewerState().stage).toBe('admitted');
    let free = -1;
    engine.book.status.forEach((s, seat) => {
      if (free < 0 && s === AVAILABLE) free = seat;
    });
    expect(engine.holdViewerSeats([free]).held).toEqual([free]);
    expect(engine.book.owner[free]).toBe(crowd.buyers + 50);
  }, 60_000);

  it('drops bots that arrive after the sale is already over', () => {
    const venue = makeVenue([[{ seats: 'sss' }]]);
    const engine = new SimulationEngine(venue, makeConfig({ buyers: 20, bots: 10 }));
    engine.advanceTo(30_000);
    const s = engine.getStats();
    expect(s.finished).toBe(true);
    expect(s.bots.admitted).toBe(0);
    expect(s.turnedAway).toBe(20);
  });

  it('gives up cleanly when no block of the size it wants is left', () => {
    // Rows of 3: a party of 4 to 8 can never be seated, so every bot's search fails.
    const venue = makeVenue([[{ seats: '...' }, { seats: '...' }]]);
    const engine = new SimulationEngine(venue, makeConfig({ buyers: 30, bots: 5, seed: 2 }));
    engine.advanceTo(3_600_000);
    const s = engine.getStats();
    expect(s.finished).toBe(true);
    expect(s.bots.seatsSold).toBe(0);
    expect(s.bots.admitted).toBe(5);
  });
});

describe('the detection comparison', () => {
  it('plays one seeded sale twice, off then on, and reports both', () => {
    const progress: number[] = [];
    const result = compareDetection(realVenue, { ...crowd, bots: 100 }, (n) => progress.push(n));
    expect(progress).toEqual([0, 1, 2]);
    expect(result.off.detection).toBe(false);
    expect(result.on.detection).toBe(true);
    // Same crowd and bots, so the best-seat pool is identical; only who got them changes.
    expect(result.on.bestSeatsTotal).toBe(result.off.bestSeatsTotal);
    expect(result.on.botsTotal).toBe(100);
    expect(result.on.fanShare).toBeGreaterThan(result.off.fanShare);
  }, 60_000);

  it('reduces a finished sale to the figures the before/after view shows', () => {
    const engine = new SimulationEngine(realVenue, {
      ...DEFAULT_CONFIG,
      buyers: 1_000,
      bots: 20,
      detection: true,
    });
    engine.advanceTo(3_600_000);
    const stats = engine.getStats();
    const outcome = outcomeOf(stats);
    expect(outcome).toMatchObject({
      detection: true,
      botsTotal: 20,
      botsBlocked: stats.bots.blocked,
      revenue: stats.revenue,
      simTimeMs: stats.simTimeMs,
    });
    expect(TICK_MS).toBe(100);
  });
});
