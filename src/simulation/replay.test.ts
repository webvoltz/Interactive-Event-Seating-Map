import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import { SimulationEngine, TICK_MS } from './engine';
import { EventLog } from './eventLog';
import { makeConfig, makeVenue } from './fixtures';
import { realVenue } from './realVenue';

describe('EventLog', () => {
  const ticks = (...t: number[]) => Uint32Array.from(t);
  const changes = (...c: [number, number][]) =>
    Uint32Array.from(c.map(([seat, s]) => (seat << 2) | s));

  it('counts entries up to a tick and rebuilds the board at it', () => {
    const log = new EventLog();
    log.append(ticks(1, 1, 4, 9), changes([0, 1], [1, 1], [0, 2], [1, 0]));
    expect(log.length).toBe(4);
    expect([0, 1, 2, 4, 8, 9, 99].map((t) => log.countAt(t))).toEqual([0, 2, 2, 3, 3, 4, 4]);

    const start = new Uint8Array(3);
    expect(Array.from(log.boardAt(start, 0))).toEqual([0, 0, 0]);
    expect(Array.from(log.boardAt(start, 1))).toEqual([1, 1, 0]);
    expect(Array.from(log.boardAt(start, 4))).toEqual([2, 1, 0]);
    expect(Array.from(log.boardAt(start, 9))).toEqual([2, 0, 0]);
    // The starting board is never altered.
    expect(Array.from(start)).toEqual([0, 0, 0]);
  });

  it('grows past its first allocation and ignores empty or mismatched appends', () => {
    const log = new EventLog();
    log.append(new Uint32Array(), new Uint32Array());
    expect(log.length).toBe(0);
    const n = 10_000;
    log.append(
      Uint32Array.from({ length: n }, (_, i) => i),
      Uint32Array.from({ length: n }, (_, i) => (i << 2) | 2),
    );
    log.append(ticks(n, n), changes([1, 1], [2, 1], [3, 1]));
    expect(log.length).toBe(n + 2);
    expect(log.byteLength).toBeGreaterThanOrEqual((n + 2) * 8);
    expect(log.boardAt(new Uint8Array(n + 1), n - 1)[n - 1]).toBe(2);
  });
});

describe('replay is exact', () => {
  it('rebuilds the board at any tick of a real sale exactly as it was', () => {
    const row = { seats: '.'.repeat(40) };
    const venue = makeVenue([[row, row], [row]]);
    const engine = new SimulationEngine(
      venue,
      makeConfig({ buyers: 500, admitPerSec: 100, holdMs: 20_000, seed: 12 }),
    );
    const initial = engine.statusSnapshot();
    const log = new EventLog();
    const truth = new Map<number, Uint8Array>();

    for (let tick = 1; !engine.finished && tick < 200_000; tick++) {
      engine.advanceTo(tick * TICK_MS);
      const delta = engine.drainDelta();
      log.append(delta.changeTicks, delta.seatChanges);
      if (tick % 7 === 0) truth.set(tick, engine.statusSnapshot());
    }

    expect(truth.size).toBeGreaterThan(50);
    expect(log.length).toBeGreaterThan(200);
    for (const [tick, board] of truth) {
      expect(log.boardAt(initial, tick)).toEqual(board);
    }
  });

  it('keeps the whole log of a 20,000-buyer sale far below the 50 MB budget', () => {
    const engine = new SimulationEngine(realVenue, DEFAULT_CONFIG);
    const log = new EventLog();
    for (let t = 10_000; !engine.finished && t < 3_600_000; t += 10_000) {
      engine.advanceTo(t);
      const delta = engine.drainDelta();
      log.append(delta.changeTicks, delta.seatChanges);
    }
    expect(engine.finished).toBe(true);
    expect(log.length).toBeGreaterThan(20_000);
    expect(log.byteLength).toBeLessThan(50 * 1024 * 1024);
    // Rebuilding mid-sale is a cheap replay of a prefix, not a re-run of the sale.
    const started = performance.now();
    const board = log.boardAt(new Uint8Array(15_000), 3_000);
    expect(performance.now() - started).toBeLessThan(100);
    expect(board).toHaveLength(15_000);
  }, 120_000);
});
