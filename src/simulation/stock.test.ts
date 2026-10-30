import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import { SimulationEngine } from './engine';
import { makeConfig, makeVenue } from './fixtures';
import { realVenue } from './realVenue';

describe('the waiting room admits against stock', () => {
  it('does not let in more buyers than there are free seats', () => {
    const venue = makeVenue([[{ seats: '.'.repeat(40) }]]);
    const engine = new SimulationEngine(
      venue,
      makeConfig({ buyers: 2000, admitPerSec: 5000, holdMs: 600_000, seed: 9 }),
    );
    // Thousands arrive at once for 40 seats; admission is far faster than the venue can serve.
    for (let t = 100; t <= 20_000; t += 100) {
      engine.advanceTo(t);
      const s = engine.getStats();
      // Stock is 40 seats. Uncapped, 5,000 admissions a second would put thousands in the search.
      expect(s.stages.searching).toBeLessThanOrEqual(45);
    }
    // Everyone who never got in is still waiting, not turned away.
    expect(engine.getStats().turnedAway).toBeLessThan(200);
    expect(engine.getStats().queueLength).toBeGreaterThan(1000);
  });

  it('keeps buyers waiting while every seat is held, and sells seats that come back', () => {
    const venue = makeVenue([[{ seats: '..........' }]]);
    const engine = new SimulationEngine(
      venue,
      makeConfig({ buyers: 1500, admitPerSec: 400, holdMs: 30_000, seed: 14 }),
    );
    engine.advanceTo(3_600_000);
    const s = engine.getStats();
    // Without waiting buyers, seats freed by lapsed holds would be left over.
    expect(s.seats.available).toBe(0);
    expect(s.seats.sold).toBe(10);
    expect(s.saleOverAtMs).not.toBeNull();
  });
});

describe('a full-size sale sells every seat', () => {
  it.each(['spike', 'waves', 'steady'] as const)(
    'ends %s with nothing left on sale, and sold out inside 2 minutes',
    (pattern) => {
      const engine = new SimulationEngine(realVenue, { ...DEFAULT_CONFIG, pattern });
      engine.advanceTo(7_200_000);
      const s = engine.getStats();
      expect(s.finished).toBe(true);
      expect(s.seats.available).toBe(0);
      expect(s.seats.sold).toBe(s.seats.total - s.seats.reserved);
      expect(s.soldPct).toBe(100);
      expect(s.saleOverAtMs).not.toBeNull();
      expect(s.soldOutAtMs ?? Infinity).toBeLessThan(120_000);
    },
    120_000,
  );
});
