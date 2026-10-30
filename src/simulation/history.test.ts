import { describe, expect, it } from 'vitest';
import { SAMPLE_MS, SimulationEngine, type SimSample } from './engine';
import { makeConfig, makeVenue } from './fixtures';
import {
  buildSummary,
  formatClock,
  formatCompact,
  formatDuration,
  formatMoney,
  formatMoneyAxis,
  niceTicks,
  sectionShares,
} from './statsFormat';

const row = { seats: '.'.repeat(40) };
const venue = makeVenue([[row, row], [row], [{ seats: '..rr..' }]]);
const config = makeConfig({ buyers: 600, admitPerSec: 100, holdMs: 30_000, seed: 4 });

function runCollecting() {
  const engine = new SimulationEngine(venue, config);
  const samples: SimSample[] = [];
  samples.push(...engine.drainDelta().samples);
  for (let t = 1_000; !engine.finished && t < 3_600_000; t += 1_000) {
    engine.advanceTo(t);
    samples.push(...engine.drainDelta().samples);
  }
  return { engine, samples, stats: engine.getStats() };
}

describe('sale history samples', () => {
  it('starts at zero and then ticks on a fixed simulated schedule, ending when the sale does', () => {
    const { samples, stats } = runCollecting();
    expect(samples[0]).toMatchObject({ t: 0, revenue: 0, soldSeats: 0 + 0, queue: 0, clashes: 0 });
    const onGrid = samples.slice(0, -1);
    onGrid.forEach((s, i) => {
      expect(s.t).toBe(i * SAMPLE_MS);
    });
    expect(samples.at(-1)?.t).toBe(stats.simTimeMs);
  });

  it('only ever grows in revenue and sold seats, and agrees with the final stats', () => {
    const { samples, stats } = runCollecting();
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]?.revenue).toBeGreaterThanOrEqual(samples[i - 1]?.revenue ?? 0);
      expect(samples[i]?.soldSeats).toBeGreaterThanOrEqual(samples[i - 1]?.soldSeats ?? 0);
    }
    const last = samples.at(-1);
    expect(last?.revenue).toBe(stats.revenue);
    expect(last?.soldSeats).toBe(stats.seats.sold);
    expect(samples.reduce((sum, s) => sum + s.clashes, 0)).toBe(stats.clashes);
  });

  it('is identical however the clock is stepped, and hands each sample over only once', () => {
    const coarse = new SimulationEngine(venue, config);
    coarse.advanceTo(2_000_000);
    const all = coarse.drainDelta().samples;
    expect(coarse.drainDelta().samples).toEqual([]);
    expect(runCollecting().samples).toEqual(all);
  });

  it('tracks, per section, when it sold out and how its seats split', () => {
    const { stats } = runCollecting();
    stats.sections.forEach((s) => {
      expect(s.sold + s.held + s.available + s.reserved).toBe(s.total);
      if (s.soldOutAtMs !== null) expect(s.soldOutAtMs).toBeLessThanOrEqual(stats.simTimeMs);
    });
    // The two plain sections sell out; the third keeps a pair of reserved seats out of the count.
    expect(stats.sections[0]?.soldOutAtMs).not.toBeNull();
    expect(stats.sections[2]?.reserved).toBe(2);
  });
});

describe('statsFormat', () => {
  it('formats clocks and durations', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(75_000)).toBe('01:15');
    expect(formatClock(3_723_000)).toBe('1:02:03');
    expect(formatClock(-5)).toBe('00:00');
    expect(formatDuration(42_400)).toBe('42s');
    expect(formatDuration(72_000)).toBe('1m 12s');
  });

  it('formats money and counts compactly', () => {
    expect(formatMoney(950)).toBe('$950');
    expect(formatMoney(4_500)).toBe('$4.5K');
    expect(formatMoney(250_000)).toBe('$250K');
    expect(formatMoney(32_971_500)).toBe('$33.0M');
    expect(formatMoneyAxis(20_000_000)).toBe('$20M');
    expect(formatMoneyAxis(0)).toBe('$0');
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(1_500)).toBe('1.5K');
    expect(formatCompact(2_000_000)).toBe('2M');
  });

  it('picks round axis ticks that cover the data', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(9_800)).toEqual([0, 5_000, 10_000]);
    expect(niceTicks(7)).toEqual([0, 5, 10]);
    expect(niceTicks(33_000_000)).toEqual([0, 20_000_000, 40_000_000]);
    for (const max of [1, 3, 14, 480, 12_345, 6_000_000]) {
      const ticks = niceTicks(max);
      expect(ticks.at(-1)).toBeGreaterThanOrEqual(max);
      expect(ticks[0]).toBe(0);
    }
  });

  it('measures section shares against sellable seats only', () => {
    expect(
      sectionShares({
        total: 100,
        sold: 40,
        held: 10,
        reserved: 50,
        available: 0,
        soldOut: true,
        soldOutAtMs: 1,
        velocity: 0,
      }),
    ).toEqual({ sold: 80, held: 20 });
    expect(
      sectionShares({
        total: 5,
        sold: 0,
        held: 0,
        reserved: 5,
        available: 0,
        soldOut: true,
        soldOutAtMs: null,
        velocity: 0,
      }),
    ).toEqual({ sold: 0, held: 0 });
  });

  it('summarises a finished sale and picks the fastest and slowest sections', () => {
    const { stats } = runCollecting();
    const summary = buildSummary(stats);
    expect(summary.seatsSold).toBe(stats.seats.sold);
    expect(summary.sellableSeats).toBe(stats.seats.total - stats.seats.reserved);
    expect(summary.revenue).toBe(stats.revenue);
    expect(summary.reservedSeats).toBe(stats.seats.reserved);
    expect(summary.unsoldSeats).toBe(stats.seats.available + stats.seats.held);
    expect(summary.saleEndedAtMs).toBe(stats.simTimeMs);
    expect(summary.fastest).not.toBeNull();

    const sections = stats.sections.map((s, i) => ({
      ...s,
      soldOutAtMs: [4_000, 9_000, null][i] ?? null,
      sold: [10, 10, 1][i] ?? 0,
      total: 20,
      reserved: 0,
    }));
    const synthetic = buildSummary({ ...stats, sections });
    expect(synthetic.fastest?.index).toBe(0);
    // A section that never sold out is the slowest, whatever the others did.
    expect(synthetic.slowest?.index).toBe(2);

    const allSold = buildSummary({
      ...stats,
      sections: sections.map((s, i) => ({ ...s, soldOutAtMs: [3_000, 8_000, 5_000][i] ?? 0 })),
    });
    expect(allSold.slowest?.index).toBe(1);

    expect(buildSummary({ ...stats, sections: [] })).toMatchObject({
      fastest: null,
      slowest: null,
    });
  });
});
