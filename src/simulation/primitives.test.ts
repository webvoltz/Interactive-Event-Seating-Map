import { describe, expect, it } from 'vitest';
import { MAX_SELECTABLE_SEATS } from '../utils/selectionLimits';
import {
  ADMIT_MAX,
  ADMIT_MIN,
  BOTS_MAX,
  BUYERS_MAX,
  BUYERS_MIN,
  DEFAULT_CONFIG,
  HOLD_MAX_MS,
  HOLD_MIN_MS,
  MAX_GROUP_SIZE,
  normalizeConfig,
  parseConfigFromSearch,
  serializeConfig,
} from './config';
import { EventQueue } from './eventQueue';
import { makeVenue } from './fixtures';
import { createRng, mix32 } from './random';
import { AVAILABLE, HELD, RESERVED, SOLD, SeatBook, buildSeatIdList } from './seatBook';
import { simStatusToEffective } from './simStatus';

describe('createRng', () => {
  it('produces the same sequence for the same seed and a different one otherwise', () => {
    const a = createRng(123);
    const b = createRng(123);
    const c = createRng(124);
    const seqA = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(seqA);
  });

  it('keeps next() in [0, 1) and int()/between() in range', () => {
    const rng = createRng(1);
    for (let i = 0; i < 2000; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(rng.int(5)).toBeGreaterThanOrEqual(0);
      expect(rng.int(5)).toBeLessThan(5);
      const n = rng.between(3, 6);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
    }
  });

  it('picks by weight, never choosing a zero-weight slot, and falls back to the last index', () => {
    const rng = createRng(9);
    const counts = [0, 0, 0];
    for (let i = 0; i < 6000; i++) {
      const pick = rng.weighted([1, 0, 3]);
      counts[pick] = (counts[pick] ?? 0) + 1;
    }
    expect(counts[1]).toBe(0);
    expect(counts[2]).toBeGreaterThan((counts[0] ?? 0) * 2);
    expect(createRng(1).weighted([0, 0])).toBe(1);
  });

  it('mix32 is stable and order sensitive', () => {
    expect(mix32(1, 2)).toBe(mix32(1, 2));
    expect(mix32(1, 2)).not.toBe(mix32(2, 1));
  });
});

describe('EventQueue', () => {
  it('pops in time order and keeps insertion order for equal times', () => {
    const q = new EventQueue();
    q.push(30, 1, 0);
    q.push(10, 2, 0);
    q.push(20, 3, 0);
    q.push(10, 4, 0);
    q.push(10, 5, 0);
    expect(q.size).toBe(5);
    expect(q.peekTime()).toBe(10);
    const order: number[] = [];
    for (let e = q.pop(); e; e = q.pop()) order.push(e.buyer);
    expect(order).toEqual([2, 4, 5, 3, 1]);
    expect(q.size).toBe(0);
  });

  it('handles an empty queue and a single element', () => {
    const q = new EventQueue();
    expect(q.pop()).toBeUndefined();
    expect(q.peekTime()).toBeNull();
    q.push(5, 1, 7);
    expect(q.pop()).toEqual({ time: 5, buyer: 1, kind: 7, seq: 0 });
    expect(q.pop()).toBeUndefined();
  });

  it('stays sorted across many random pushes and pops', () => {
    const rng = createRng(77);
    const q = new EventQueue();
    for (let i = 0; i < 500; i++) q.push(rng.int(1000), i, 0);
    let prev = -1;
    for (let e = q.pop(); e; e = q.pop()) {
      expect(e.time).toBeGreaterThanOrEqual(prev);
      prev = e.time;
    }
  });
});

describe('config', () => {
  it('caps the group size at the booking limit', () => {
    expect(MAX_GROUP_SIZE).toBe(MAX_SELECTABLE_SEATS);
  });

  it('clamps out-of-range values and rejects an unknown pattern', () => {
    const low = normalizeConfig({ buyers: 5, admitPerSec: 0, holdMs: 1, seed: -3 });
    expect(low.buyers).toBe(BUYERS_MIN);
    expect(low.admitPerSec).toBe(ADMIT_MIN);
    expect(low.holdMs).toBe(HOLD_MIN_MS);
    const high = normalizeConfig({ buyers: 1e9, admitPerSec: 1e9, holdMs: 1e12 });
    expect(high.buyers).toBe(BUYERS_MAX);
    expect(high.admitPerSec).toBe(ADMIT_MAX);
    expect(high.holdMs).toBe(HOLD_MAX_MS);
  });

  it('round-trips through the URL', () => {
    const config = normalizeConfig({
      buyers: 7000,
      pattern: 'waves',
      admitPerSec: 250,
      holdMs: 120_000,
      seed: 4242,
    });
    expect(parseConfigFromSearch(`?${serializeConfig(config)}`)).toEqual(config);
  });

  it('falls back to defaults for a missing, junk or hand-edited query', () => {
    expect(parseConfigFromSearch('')).toEqual(DEFAULT_CONFIG);
    expect(parseConfigFromSearch('?buyers=abc&pattern=zig&admit=&hold=x&seed=NaN')).toEqual(
      DEFAULT_CONFIG,
    );
    expect(parseConfigFromSearch('?buyers=999999').buyers).toBe(BUYERS_MAX);
    expect(parseConfigFromSearch('?hold=60').holdMs).toBe(60_000);
  });
});

describe('scalper bot settings', () => {
  it('keeps bots and detection out of the URL until they are used', () => {
    expect(serializeConfig(DEFAULT_CONFIG)).not.toMatch(/bots|detect/);
    const used = normalizeConfig({ bots: 500, detection: true });
    const query = serializeConfig(used);
    expect(query).toContain('bots=500');
    expect(query).toContain('detect=1');
    expect(parseConfigFromSearch(`?${query}`)).toEqual(used);
  });

  it('clamps the bot count and ignores a malformed detect flag', () => {
    expect(normalizeConfig({ bots: -4 }).bots).toBe(0);
    expect(normalizeConfig({ bots: 1e9 }).bots).toBe(BOTS_MAX);
    expect(parseConfigFromSearch('?bots=junk&detect=yes')).toEqual(DEFAULT_CONFIG);
    expect(parseConfigFromSearch('?bots=250').detection).toBe(false);
  });
});

describe('SeatBook', () => {
  const venue = makeVenue([[{ seats: '..s.r' }], [{ seats: 'h..' }]]);

  it('indexes seats in venue order and counts the pre-sale board', () => {
    const book = new SeatBook(venue);
    expect(buildSeatIdList(venue)).toEqual(book.ids);
    expect(book.seatCount).toBe(8);
    expect(book.indexById.get('T-6')).toBe(5);
    // 'h' (pre-sale held) is just an ordinary seat on sale day.
    expect(book.availableCount).toBe(6);
    expect(book.soldCount).toBe(1);
    expect(book.status[2]).toBe(SOLD);
    expect(book.status[4]).toBe(RESERVED);
    expect(book.status[5]).toBe(AVAILABLE);
    expect(book.sectionAvailable[0]).toBe(3);
    expect(book.sectionAvailable[1]).toBe(3);
    expect(book.sectionSeatTotal[0]).toBe(5);
  });

  it('moves a seat through hold, release and sell, keeping every counter in step', () => {
    const book = new SeatBook(venue);
    expect(book.hold(0, 3)).toBe(true);
    expect(book.hold(0, 4)).toBe(false);
    expect(book.hold(2, 4)).toBe(false);
    expect(book.status[0]).toBe(HELD);
    expect(book.owner[0]).toBe(3);
    expect([book.availableCount, book.heldCount]).toEqual([5, 1]);

    book.release(0);
    book.release(0);
    expect([book.availableCount, book.heldCount]).toEqual([6, 0]);

    book.hold(1, 1);
    book.sell(1);
    book.sell(1);
    book.release(1);
    expect(book.status[1]).toBe(SOLD);
    expect([book.availableCount, book.heldCount, book.soldCount]).toEqual([5, 0, 2]);
    expect(book.sectionSold[0]).toBe(2);
  });

  it('finds the longest side-by-side run, honouring price caps and invalidating on change', () => {
    const priced = makeVenue([
      [
        { seats: '....', tier: 1 },
        { seats: '.s..', tier: 3 },
      ],
    ]);
    const book = new SeatBook(priced);
    expect(book.longestFreeRun(0, 7000)).toBe(4);
    expect(book.longestFreeRun(0, 1500)).toBe(2);
    expect(book.longestFreeRun(0, 10)).toBe(0);
    book.hold(1, 0);
    expect(book.longestFreeRun(0, 7000)).toBe(2);
    book.release(1);
    expect(book.longestFreeRun(0, 7000)).toBe(4);
  });

  it('does not join runs across a row break or a column gap', () => {
    const gappy = makeVenue([[{ seats: '..' }, { seats: '..' }]]);
    const book = new SeatBook(gappy);
    expect(book.longestFreeRun(0, 7000)).toBe(2);
  });
});

describe('simStatusToEffective', () => {
  it('maps every board code to a seat status', () => {
    expect(simStatusToEffective(AVAILABLE)).toBe('available');
    expect(simStatusToEffective(HELD)).toBe('held');
    expect(simStatusToEffective(SOLD)).toBe('sold');
    expect(simStatusToEffective(RESERVED)).toBe('reserved');
    expect(simStatusToEffective(99)).toBe('available');
  });
});
