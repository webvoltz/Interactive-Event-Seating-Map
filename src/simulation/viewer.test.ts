import { describe, expect, it } from 'vitest';
import { SimulationEngine, TICK_MS } from './engine';
import { EventLog } from './eventLog';
import { makeConfig, makeVenue } from './fixtures';
import { realVenue } from './realVenue';
import { AVAILABLE, HELD, SOLD } from './seatBook';

const crowd = makeConfig({ buyers: 1500, admitPerSec: 100, holdMs: 120_000, seed: 31 });

function admittedViewer() {
  const engine = new SimulationEngine(realVenue, crowd);
  engine.advanceTo(3_000);
  engine.joinViewer();
  for (let t = 3_000; engine.getViewerState().stage === 'queued' && t < 200_000; t += 500) {
    engine.advanceTo(t);
  }
  return engine;
}

function freeSeats(engine: SimulationEngine, count: number): number[] {
  const seats: number[] = [];
  engine.book.status.forEach((status, seat) => {
    if (status === AVAILABLE && seats.length < count) seats.push(seat);
  });
  return seats;
}

describe('the viewer in the waiting room', () => {
  it('joins at the back, sees the queue shorten, and is admitted in turn', () => {
    const engine = new SimulationEngine(realVenue, crowd);
    engine.advanceTo(3_000);
    expect(engine.getViewerState()).toMatchObject({ stage: 'none', position: null, seats: [] });

    engine.joinViewer();
    const joined = engine.getViewerState();
    const stats = engine.getStats();
    expect(joined.stage).toBe('queued');
    // First come, first served: everyone already waiting is ahead, and the viewer is counted too.
    expect(joined.position).toBe(stats.queueLength);
    expect(stats.queueLength).toBe(stats.stages.queued + 1);
    expect(joined.etaMs).toBeCloseTo(((joined.position ?? 0) / crowd.admitPerSec) * 1000);

    engine.joinViewer();
    expect(engine.getViewerState().position).toBe(joined.position);

    engine.advanceTo(8_000);
    const later = engine.getViewerState();
    expect(later.position ?? Infinity).toBeLessThan(joined.position ?? 0);

    for (let t = 8_000; engine.getViewerState().stage === 'queued' && t < 200_000; t += 500) {
      engine.advanceTo(t);
    }
    expect(engine.getViewerState()).toMatchObject({
      stage: 'admitted',
      position: null,
      etaMs: null,
    });
  });

  it('reports no wait while every seat is held and admission is paused', () => {
    const tiny = makeVenue([[{ seats: '....' }]]);
    const engine = new SimulationEngine(
      tiny,
      makeConfig({ buyers: 200, admitPerSec: 200, seed: 2 }),
    );
    engine.advanceTo(10_000);
    expect(engine.book.availableCount).toBe(0);
    engine.joinViewer();
    const state = engine.getViewerState();
    expect(state.stage).toBe('queued');
    expect(state.etaMs).toBeNull();
  });

  it('is told the sale is over if nothing is left, or when the last seat goes while they wait', () => {
    const soldOut = new SimulationEngine(
      makeVenue([[{ seats: 'sss' }]]),
      makeConfig({ buyers: 20 }),
    );
    soldOut.joinViewer();
    expect(soldOut.getViewerState().stage).toBe('turned-away');

    // One seat and a big crowd: if it sells before the viewer's turn, they are turned away. If a
    // lapsed hold put it back on sale first, they get in. Both are right; across seeds we see both.
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 25; seed++) {
      const small = new SimulationEngine(
        makeVenue([[{ seats: '.' }]]),
        makeConfig({ buyers: 300, admitPerSec: 50, holdMs: 20_000, seed }),
      );
      small.advanceTo(500);
      small.joinViewer();
      small.advanceTo(3_600_000);
      outcomes.add(small.getViewerState().stage);
      expect(small.getStats().queueLength).toBe(0);
    }
    expect(outcomes.has('turned-away')).toBe(true);
    expect([...outcomes].every((stage) => stage === 'turned-away' || stage === 'admitted')).toBe(
      true,
    );
  });

  it('can leave the queue, which frees their place, and join again', () => {
    const engine = new SimulationEngine(realVenue, crowd);
    engine.advanceTo(3_000);
    const before = engine.getStats().queueLength;
    engine.joinViewer();
    engine.leaveViewer();
    expect(engine.getViewerState().stage).toBe('left');
    expect(engine.getStats().queueLength).toBe(before);
    engine.joinViewer();
    expect(engine.getViewerState().stage).toBe('queued');
  });
});

describe('the viewer picking seats', () => {
  it('cannot hold anything before being admitted', () => {
    const engine = new SimulationEngine(realVenue, crowd);
    engine.advanceTo(1_000);
    engine.joinViewer();
    const [seat = 0] = freeSeats(engine, 1);
    expect(engine.holdViewerSeats([seat])).toEqual({ held: [], rejected: [seat] });
    expect(engine.book.status[seat]).toBe(AVAILABLE);
  });

  it('holds seats the crowd can then not take, however long the sale runs on', () => {
    const engine = admittedViewer();
    const seats = freeSeats(engine, 3);
    expect(engine.holdViewerSeats(seats)).toEqual({ held: seats, rejected: [] });
    for (const seat of seats) {
      expect(engine.book.status[seat]).toBe(HELD);
      expect(engine.book.owner[seat]).toBe(crowd.buyers);
    }
    expect(engine.getViewerState().seats).toEqual(seats);

    // Their hold has no timer of its own here: the booking UI's checkout timer decides.
    engine.advanceTo(engine.simTimeMs + 600_000);
    for (const seat of seats) {
      expect(engine.book.status[seat]).toBe(HELD);
      expect(engine.book.owner[seat]).toBe(crowd.buyers);
    }
  });

  it('loses a seat the crowd got first', () => {
    const engine = admittedViewer();
    let taken = -1;
    engine.book.status.forEach((status, seat) => {
      if (taken < 0 && status === HELD && (engine.book.owner[seat] ?? 0) < crowd.buyers)
        taken = seat;
    });
    expect(taken).toBeGreaterThanOrEqual(0);
    expect(engine.holdViewerSeats([taken])).toEqual({ held: [], rejected: [taken] });
  });

  it('holds at most one booking’s worth of seats', () => {
    const engine = admittedViewer();
    const seats = freeSeats(engine, 9);
    const result = engine.holdViewerSeats(seats);
    expect(result.held).toHaveLength(8);
    expect(result.rejected).toEqual(seats.slice(8));
  });

  it('puts seats back on sale when released, and sells them when paid for', () => {
    const engine = admittedViewer();
    const [a = 0, b = 0, c = 0] = freeSeats(engine, 3);
    engine.holdViewerSeats([a, b, c]);
    const availableBefore = engine.book.availableCount;
    const revenueBefore = engine.getStats().revenue;

    engine.releaseViewerSeats([a, 999_999]);
    expect(engine.book.status[a]).toBe(AVAILABLE);
    expect(engine.book.availableCount).toBe(availableBefore + 1);

    engine.buyViewerSeats([b, a]);
    expect(engine.book.status[b]).toBe(SOLD);
    expect(engine.book.status[a]).toBe(AVAILABLE);
    expect(engine.getStats().revenue).toBe(revenueBefore + (engine.book.price[b] ?? 0));
    expect(engine.getViewerState()).toMatchObject({ seats: [c], seatsBought: 1 });
  });

  it('gives the seats back when the viewer leaves', () => {
    const engine = admittedViewer();
    const seats = freeSeats(engine, 2);
    engine.holdViewerSeats(seats);
    const held = engine.book.heldCount;
    engine.leaveViewer();
    expect(engine.book.heldCount).toBe(held - 2);
    expect(engine.getViewerState()).toMatchObject({ stage: 'left', seats: [] });
  });

  it('lands in the event log, so a replay shows the viewer’s seats too', () => {
    const engine = admittedViewer();
    const initial = new SimulationEngine(realVenue, crowd).statusSnapshot();
    const log = new EventLog();
    // Everything up to now, from the start, plus the viewer's own pick.
    const replay = new SimulationEngine(realVenue, crowd);
    replay.advanceTo(3_000);
    replay.joinViewer();
    for (let t = 3_000; replay.getViewerState().stage === 'queued' && t < 200_000; t += TICK_MS) {
      replay.advanceTo(t);
    }
    const [seat = 0] = freeSeats(replay, 1);
    replay.holdViewerSeats([seat]);
    const tick = Math.floor(replay.simTimeMs / TICK_MS);
    const delta = replay.drainDelta();
    log.append(delta.changeTicks, delta.seatChanges);
    expect(log.boardAt(initial, tick)[seat]).toBe(HELD);
    expect(engine.getViewerState().stage).toBe('admitted');
  });
});
