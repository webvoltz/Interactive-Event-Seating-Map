import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_VIEWER, makeBatch, makeConfig, makeVenue } from './fixtures';
import { SimulationEngine } from './engine';
import { pump, type PacerState } from './pacer';
import type { WorkerEvent } from './protocol';
import { HELD, SOLD } from './seatBook';
import { useSimulationStore, type SimBatch } from './simulationStore';
import type { SimStats } from './engine';

const venue = makeVenue([[{ seats: '.'.repeat(30) }], [{ seats: '.'.repeat(30) }]]);

function statsFor(overrides: Partial<SimStats> = {}): SimStats {
  const engine = new SimulationEngine(venue, makeConfig({ buyers: 10 }));
  return { ...engine.getStats(), ...overrides };
}

describe('pump (wall time to sale time)', () => {
  const noDeadline = () => false;

  it('converts elapsed wall time into simulated time at the chosen speed', () => {
    const engine = new SimulationEngine(venue, makeConfig({ buyers: 1000, admitPerSec: 50 }));
    const state: PacerState = { owedSimMs: 0 };
    pump(engine, state, 100, 10, noDeadline);
    expect(engine.simTimeMs).toBe(1000);
    pump(engine, state, 100, 100, noDeadline);
    expect(engine.simTimeMs).toBe(11_000);
    expect(state.owedSimMs).toBeLessThan(100);
  });

  it('carries sub-tick time forward instead of dropping it', () => {
    const engine = new SimulationEngine(venue, makeConfig({ buyers: 1000 }));
    const state: PacerState = { owedSimMs: 0 };
    pump(engine, state, 5, 10, noDeadline);
    expect(engine.simTimeMs).toBe(0);
    pump(engine, state, 5, 10, noDeadline);
    expect(engine.simTimeMs).toBe(100);
  });

  it('stops when the wall budget is spent and caps how far behind it will chase', () => {
    const engine = new SimulationEngine(venue, makeConfig({ buyers: 1000 }));
    const state: PacerState = { owedSimMs: 0 };
    pump(engine, state, 60_000, 10, () => true);
    expect(engine.simTimeMs).toBe(0);
    expect(state.owedSimMs).toBe(10_000);
  });

  it('does nothing once the sale has finished', () => {
    const engine = new SimulationEngine(makeVenue([[{ seats: 'ss' }]]), makeConfig({ buyers: 5 }));
    engine.advanceTo(60_000);
    expect(engine.finished).toBe(true);
    const state: PacerState = { owedSimMs: 0 };
    const at = engine.simTimeMs;
    pump(engine, state, 1000, 100, noDeadline);
    expect(engine.simTimeMs).toBe(at);
  });
});

describe('simulation store', () => {
  beforeEach(() => {
    useSimulationStore.getState().clearRun();
  });

  const begin = () => {
    const status = new Uint8Array(4);
    useSimulationStore.getState().beginRun(
      status,
      new Map([
        ['a', 0],
        ['b', 1],
      ]),
      ['Section 1', 'Section 2'],
      statsFor(),
    );
    return status;
  };

  const batch = (changes: number[], soldOut: number[], stats: SimStats): SimBatch =>
    makeBatch(stats, {
      seatChanges: Uint32Array.from(changes),
      changeTicks: new Uint32Array(changes.length),
      soldOutSections: soldOut,
    });

  it('normalises settings as they are changed', () => {
    useSimulationStore.getState().setConfig({ buyers: 1, pattern: 'waves' });
    const { config } = useSimulationStore.getState();
    expect(config.buyers).toBe(1000);
    expect(config.pattern).toBe('waves');
  });

  it('merges several batches into one update, in place, in order', () => {
    const status = begin();
    const before = useSimulationStore.getState().seatVersion;
    useSimulationStore
      .getState()
      .applyBatches(
        [
          batch([(0 << 2) | HELD, (1 << 2) | HELD], [], statsFor({ simTimeMs: 100 })),
          batch([(0 << 2) | SOLD], [], statsFor({ simTimeMs: 200 })),
        ],
        1000,
      );
    const state = useSimulationStore.getState();
    expect(state.seatStatus).toBe(status);
    expect(Array.from(status)).toEqual([SOLD, HELD, 0, 0]);
    expect(state.stats?.simTimeMs).toBe(200);
    expect(state.seatVersion).toBe(before + 1);
  });

  it('announces a sold-out section, the whole venue selling out, and the end of the sale', () => {
    begin();
    const { applyBatches } = useSimulationStore.getState();

    applyBatches([batch([], [1], statsFor())], 500);
    expect(useSimulationStore.getState().announcement).toBe('Section 2 has sold out.');
    expect(useSimulationStore.getState().soldOutAt[1]).toBe(500);

    applyBatches([batch([], [], statsFor({ soldOutAtMs: 9000 }))], 600);
    expect(useSimulationStore.getState().announcement).toBe('All seats are now held or sold.');

    applyBatches([batch([], [], statsFor({ soldOutAtMs: 9000, finished: true }))], 700);
    const end = useSimulationStore.getState();
    expect(end.phase).toBe('finished');
    expect(end.announcement).toMatch(/^Sale complete\./);
  });

  it('falls back to a numbered label and ignores batches before a run exists', () => {
    useSimulationStore.getState().applyBatches([batch([], [0], statsFor())], 1);
    expect(useSimulationStore.getState().stats).toBeNull();

    useSimulationStore.getState().beginRun(new Uint8Array(1), new Map(), [], statsFor());
    useSimulationStore.getState().applyBatches([batch([], [4], statsFor())], 1);
    expect(useSimulationStore.getState().announcement).toBe('Section 5 has sold out.');
    useSimulationStore.getState().applyBatches([], 2);
  });

  it('clears the whole run on reset and tracks speed, heatmap and phase', () => {
    begin();
    useSimulationStore.getState().setSpeed(100);
    useSimulationStore.getState().setHeatmap(true);
    useSimulationStore.getState().setPhase('paused');
    expect(useSimulationStore.getState()).toMatchObject({
      speed: 100,
      heatmap: true,
      phase: 'paused',
    });
    useSimulationStore.getState().clearRun();
    expect(useSimulationStore.getState()).toMatchObject({
      phase: 'idle',
      seatStatus: null,
      stats: null,
    });
    useSimulationStore.getState().setHeatmap(false);
  });
});

// The worker and its controller talk over postMessage, so they are tested against a fake Worker.
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerEvent>) => void) | null = null;
  sent: { type: string }[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: { type: string }) {
    this.sent.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  emit(event: WorkerEvent) {
    this.onmessage?.(new MessageEvent('message', { data: event }));
  }
}

describe('simulation controller', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    useSimulationStore.getState().clearRun();
    useSimulationStore.getState().setConfig({ buyers: 5000, seed: 99, pattern: 'steady' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts a sale from the saved settings, runs once the worker is ready, and mirrors its batches', async () => {
    const controller = await import('./simulationController');
    controller.startSale(venue);
    const worker = FakeWorker.instances[0];
    if (!worker) throw new Error('worker was not created');
    expect(worker.sent[0]).toMatchObject({ type: 'init', config: { buyers: 5000, seed: 99 } });
    expect(window.location.search).toContain('seed=99');

    const stats = statsFor();
    worker.emit({ type: 'ready', seatStatus: new Uint8Array(60), stats, viewer: IDLE_VIEWER });
    expect(worker.sent.map((m) => m.type)).toEqual(['init', 'speed', 'start']);
    expect(useSimulationStore.getState().phase).toBe('running');
    expect(useSimulationStore.getState().seatIndexById?.get('T-1')).toBe(0);

    worker.emit({
      type: 'batch',
      seatChanges: Uint32Array.from([(2 << 2) | HELD]),
      changeTicks: Uint32Array.from([3]),
      soldOutSections: [],
      samples: [],
      stats: statsFor({ simTimeMs: 500 }),
      viewer: IDLE_VIEWER,
      viewerRejected: [],
    });
    expect(useSimulationStore.getState().seatStatus?.[2]).toBe(HELD);
    expect(useSimulationStore.getState().stats?.simTimeMs).toBe(500);

    controller.pauseSale();
    expect(useSimulationStore.getState().phase).toBe('paused');
    controller.setSaleSpeed(100);
    controller.resumeSale();
    expect(useSimulationStore.getState().phase).toBe('running');
    expect(worker.sent.slice(-3).map((m) => m.type)).toEqual(['pause', 'speed', 'resume']);

    controller.resetSale();
    expect(worker.terminated).toBe(true);
    expect(useSimulationStore.getState().phase).toBe('idle');
    // Reset on an already-clean controller is harmless.
    controller.resetSale();
  });

  it('ignores a ready message that arrives with no venue to describe', async () => {
    const controller = await import('./simulationController');
    controller.resetSale();
    controller.startSale(venue);
    controller.resetSale();
    expect(useSimulationStore.getState().seatStatus).toBeNull();
  });
});

describe('simulation worker', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('builds an engine, runs it on a timer, honours pause and speed, and rebuilds on reset', async () => {
    vi.useFakeTimers();
    const posted: WorkerEvent[] = [];
    const post = vi.fn((message: WorkerEvent) => {
      posted.push(message);
    });
    Object.defineProperty(self, 'postMessage', { value: post, configurable: true, writable: true });
    await import('./simulation.worker');

    const send = (data: unknown) => {
      self.onmessage?.call(self, new MessageEvent('message', { data }));
    };

    send({ type: 'garbage-without-engine' });
    send({ type: 'start' });
    send({ type: 'init', venue, config: makeConfig({ buyers: 1000, admitPerSec: 100 }) });
    expect(posted[0]?.type).toBe('ready');
    send(42);

    send({ type: 'speed', speed: 100 });
    send({ type: 'start' });
    await vi.advanceTimersByTimeAsync(1500);
    const batches = posted.filter((m) => m.type === 'batch');
    expect(batches.length).toBeGreaterThan(5);

    send({ type: 'pause' });
    const countAfterPause = posted.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(posted.length).toBe(countAfterPause);

    send({ type: 'resume' });
    await vi.advanceTimersByTimeAsync(60_000);
    send({ type: 'resume' });
    send({ type: 'reset', config: makeConfig({ buyers: 1000, seed: 5 }) });
    expect(posted.at(-1)?.type).toBe('ready');
  });

  it('relays the viewer’s commands, refusing seats it cannot give and restarting a stopped sale for a newcomer', async () => {
    vi.useFakeTimers();
    const posted: WorkerEvent[] = [];
    Object.defineProperty(self, 'postMessage', {
      value: (message: WorkerEvent) => {
        posted.push(message);
      },
      configurable: true,
      writable: true,
    });
    await import('./simulation.worker');
    const send = (data: unknown) => {
      self.onmessage?.call(self, new MessageEvent('message', { data }));
    };
    const lastBatch = () => {
      const batch = posted.filter((m) => m.type === 'batch').at(-1);
      if (batch?.type !== 'batch') throw new Error('no batch was posted');
      return batch;
    };

    send({ type: 'init', venue, config: makeConfig({ buyers: 1000, admitPerSec: 100, seed: 3 }) });
    send({ type: 'start' });
    await vi.advanceTimersByTimeAsync(300);

    send({ type: 'viewerJoin' });
    expect(lastBatch().viewer.stage).toBe('queued');
    send({ type: 'viewerHold', seats: [0, 1] });
    // Still in the waiting room, so there is nothing they may hold.
    expect(lastBatch().viewerRejected).toEqual([0, 1]);
    send({ type: 'viewerRelease', seats: [0] });
    send({ type: 'viewerBuy', seats: [0] });
    expect(lastBatch().viewerRejected).toEqual([]);
    send({ type: 'viewerLeave' });
    expect(lastBatch().viewer.stage).toBe('left');

    // Paused: a newcomer joins the queue but the sale does not start by itself.
    send({ type: 'pause' });
    const frozen = posted.length;
    send({ type: 'viewerJoin' });
    const afterJoin = posted.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(posted.length).toBe(afterJoin);
    expect(afterJoin).toBeGreaterThan(frozen);

    // Running but with its timer stopped (finished): joining wakes it again.
    send({ type: 'resume' });
    await vi.advanceTimersByTimeAsync(600_000);
    send({ type: 'viewerLeave' });
    send({ type: 'viewerJoin' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(lastBatch().viewer.stage).not.toBe('none');
  });

  it('plays a comparison in one go: progress after each sale, then both results', async () => {
    const posted: WorkerEvent[] = [];
    Object.defineProperty(self, 'postMessage', {
      value: (message: WorkerEvent) => {
        posted.push(message);
      },
      configurable: true,
      writable: true,
    });
    await import('./simulation.worker');
    self.onmessage?.call(
      self,
      new MessageEvent('message', {
        data: { type: 'compare', venue, config: makeConfig({ buyers: 1000, bots: 20, seed: 6 }) },
      }),
    );
    const kinds = posted.map((m) =>
      m.type === 'comparisonProgress' ? `progress${m.finished}` : m.type,
    );
    expect(kinds).toEqual(['progress0', 'progress1', 'progress2', 'comparison']);
    const last = posted.at(-1);
    if (last?.type !== 'comparison') throw new Error('no comparison result');
    expect(last.result.off.detection).toBe(false);
    expect(last.result.on.detection).toBe(true);
    expect(last.result.on.botsTotal).toBe(20);
  });
});
