import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  SimulationEngine,
  type SimSample,
  type SimStats,
  type ViewerState,
} from '../simulation/engine';
import { IDLE_VIEWER, makeBatch, makeConfig, makeVenue } from '../simulation/fixtures';
import { AVAILABLE, HELD, SOLD } from '../simulation/seatBook';
import * as controller from '../simulation/simulationController';
import {
  NO_VIEWER,
  selectDisplayStats,
  snapshotAtOrBefore,
  useSimulationStore,
} from '../simulation/simulationStore';
import { viewerGate } from '../simulation/viewerGate';
import { useVenueStore } from '../store/seatStore';
import { FakeWorker } from '../test/fakeWorker';
import SaleTopBar from './SaleTopBar';
import Seats from './Seat';
import ViewerRuntime from './ViewerRuntime';

const row = { seats: '.'.repeat(8) };
const venue = makeVenue([[row], [row]]);
const ids = venue.sections.flatMap((s) => s.rows.flatMap((r) => r.seats.map((seat) => seat.id)));
const indexById = new Map(ids.map((id, i) => [id, i]));
const firstRow = venue.sections[0]?.rows ?? [];

function statsAt(simTimeMs: number, overrides: Partial<SimStats> = {}): SimStats {
  const engine = new SimulationEngine(venue, makeConfig({ buyers: 10 }));
  return { ...engine.getStats(), simTimeMs, ...overrides };
}

function sampleAt(t: number): SimSample {
  return {
    t,
    revenue: t,
    soldSeats: 0,
    heldSeats: 0,
    queue: 0,
    activeHolds: 0,
    clashes: 0,
    snapshot: statsAt(t, { queueLength: t / 1000 }),
  };
}

// A run in progress with a few seat changes at known ticks.
function startRun(viewer: ViewerState = NO_VIEWER) {
  const stats = statsAt(60_000);
  useSimulationStore
    .getState()
    .beginRun(new Uint8Array(ids.length), indexById, ['Section 1', 'Section 2'], stats, viewer);
  useSimulationStore.setState({ phase: 'running' });
  useSimulationStore.getState().applyBatches(
    [
      makeBatch(stats, {
        seatChanges: Uint32Array.from([
          (0 << 2) | HELD,
          (1 << 2) | HELD,
          (0 << 2) | SOLD,
          (1 << 2) | AVAILABLE,
        ]),
        changeTicks: Uint32Array.from([10, 20, 300, 500]),
        samples: [sampleAt(0), sampleAt(5000), sampleAt(10_000), sampleAt(60_000)],
        viewer,
      }),
    ],
    0,
  );
  return stats;
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  controller.resetSale();
  useVenueStore.setState({
    selectedSeats: new Set(),
    soldSeats: new Set(),
    feedback: null,
    selectionExpiresAt: null,
  });
});

afterEach(() => {
  controller.resetSale();
  vi.unstubAllGlobals();
});

describe('replay in the store', () => {
  it('rebuilds the board at the scrubbed moment and goes back to live', () => {
    startRun();
    const store = useSimulationStore.getState;
    expect(Array.from(store().seatStatus?.subarray(0, 2) ?? [])).toEqual([SOLD, AVAILABLE]);

    // Tick = 100 ms: seat 0 is held on tick 10, seat 1 on tick 20, seat 0 sold on 300, seat 1 freed on 500.
    store().setReplayAt(1_000);
    expect(store().replayAtMs).toBe(1_000);
    expect(Array.from(store().seatStatus?.subarray(0, 2) ?? [])).toEqual([HELD, AVAILABLE]);
    expect(store().seatStatus).not.toBe(store().liveStatus);

    store().setReplayAt(2_000);
    expect(Array.from(store().seatStatus?.subarray(0, 2) ?? [])).toEqual([HELD, HELD]);
    store().setReplayAt(0);
    expect(Array.from(store().seatStatus?.subarray(0, 2) ?? [])).toEqual([AVAILABLE, AVAILABLE]);
    store().setReplayAt(30_000);
    expect(Array.from(store().seatStatus?.subarray(0, 2) ?? [])).toEqual([SOLD, HELD]);

    store().setReplayAt(999_999);
    expect(store().replayAtMs).toBeNull();
    expect(store().seatStatus).toBe(store().liveStatus);
    store().setReplayAt(-5);
    expect(store().replayAtMs).toBe(0);
    store().setReplayAt(null);
    expect(store().seatStatus).toBe(store().liveStatus);
  });

  it('keeps live changes flowing into the live board while a past moment is on screen', () => {
    const stats = startRun();
    useSimulationStore.getState().setReplayAt(1_000);
    useSimulationStore.getState().applyBatches(
      [
        makeBatch(stats, {
          seatChanges: Uint32Array.from([(5 << 2) | SOLD]),
          changeTicks: Uint32Array.from([700]),
        }),
      ],
      0,
    );
    expect(useSimulationStore.getState().seatStatus?.[5]).toBe(AVAILABLE);
    useSimulationStore.getState().setReplayAt(null);
    expect(useSimulationStore.getState().seatStatus?.[5]).toBe(SOLD);
  });

  it('does nothing without a run', () => {
    useSimulationStore.getState().setReplayAt(500);
    expect(useSimulationStore.getState().replayAtMs).toBeNull();
  });

  it('shows the snapshot taken at or before the replayed moment', () => {
    startRun();
    const { series } = useSimulationStore.getState();
    expect(snapshotAtOrBefore(series, 7_000)?.queueLength).toBe(5);
    expect(snapshotAtOrBefore(series, 10_000)?.queueLength).toBe(10);
    expect(snapshotAtOrBefore(series, 59_000)?.queueLength).toBe(10);
    expect(snapshotAtOrBefore([], 100)).toBeNull();

    const live = useSimulationStore.getState().stats;
    expect(selectDisplayStats({ stats: live, series, replayAtMs: null })).toBe(live);
    expect(selectDisplayStats({ stats: live, series, replayAtMs: 7_000 })?.queueLength).toBe(5);
    expect(selectDisplayStats({ stats: live, series: [], replayAtMs: 7_000 })).toBe(live);
  });

  it('announces when the viewer is admitted or turned away', () => {
    const stats = startRun();
    const apply = (stage: ViewerState['stage']) => {
      useSimulationStore
        .getState()
        .applyBatches([makeBatch(stats, { viewer: { ...IDLE_VIEWER, stage } })], 0);
      return useSimulationStore.getState().announcement;
    };
    expect(apply('admitted')).toMatch(/your turn/i);
    expect(apply('turned-away')).toBe('The sale ended before your turn.');
  });
});

describe('viewerGate', () => {
  it('lets anyone through when no sale is on screen', () => {
    expect(viewerGate()).toBeNull();
  });

  it('explains why seats are closed at each stage, and opens them once admitted', () => {
    startRun();
    const set = (viewer: Partial<ViewerState>) => {
      useSimulationStore.setState({ viewer: { ...IDLE_VIEWER, ...viewer } });
    };
    expect(viewerGate()).toMatch(/Join the waiting room/);
    set({ stage: 'queued', position: 1234 });
    expect(viewerGate()).toMatch(/position 1,234/);
    set({ stage: 'queued', position: null });
    expect(viewerGate()).toMatch(/waiting room\. Seats open/);
    set({ stage: 'turned-away' });
    expect(viewerGate()).toBe('The sale ended before your turn.');
    set({ stage: 'admitted' });
    expect(viewerGate()).toBeNull();
    useSimulationStore.getState().setReplayAt(500);
    expect(viewerGate()).toMatch(/replay/);
    useSimulationStore.getState().setReplayAt(null);
    useSimulationStore.setState({ phase: 'finished' });
    set({ stage: 'left' });
    expect(viewerGate()).toBe('The sale has ended.');
  });
});

describe('controller: replay, queue and seats', () => {
  const start = () => {
    controller.startSale(venue);
    const worker = FakeWorker.latest();
    worker.emit({
      type: 'ready',
      seatStatus: new Uint8Array(ids.length),
      stats: statsAt(0),
      viewer: IDLE_VIEWER,
    });
    return worker;
  };

  it('pauses a running sale while scrubbing and resumes it on going live', () => {
    const worker = start();
    expect(useSimulationStore.getState().phase).toBe('running');
    // Give the run some history to scrub through.
    worker.emit({
      type: 'batch',
      seatChanges: new Uint32Array(),
      changeTicks: new Uint32Array(),
      soldOutSections: [],
      samples: [],
      stats: statsAt(60_000),
      viewer: IDLE_VIEWER,
      viewerRejected: [],
    });

    controller.scrubTo(20_000);
    expect(worker.types().slice(-1)).toEqual(['pause']);
    expect(useSimulationStore.getState()).toMatchObject({ phase: 'paused', replayAtMs: 20_000 });

    controller.scrubTo(30_000);
    expect(worker.types().filter((t) => t === 'pause')).toHaveLength(1);

    // Dragging back to the end is the same as going live.
    controller.scrubTo(60_000);
    expect(useSimulationStore.getState()).toMatchObject({ phase: 'running', replayAtMs: null });
    expect(worker.types().slice(-1)).toEqual(['resume']);

    controller.scrubTo(10_000);
    controller.goLive();
    expect(useSimulationStore.getState().phase).toBe('running');
  });

  it('leaves a sale the user paused paused, and the resume button also goes live', () => {
    const worker = start();
    worker.emit({
      type: 'batch',
      seatChanges: new Uint32Array(),
      changeTicks: new Uint32Array(),
      soldOutSections: [],
      samples: [],
      stats: statsAt(60_000),
      viewer: IDLE_VIEWER,
      viewerRejected: [],
    });
    controller.pauseSale();
    controller.scrubTo(5_000);
    controller.goLive();
    expect(useSimulationStore.getState()).toMatchObject({ phase: 'paused', replayAtMs: null });

    controller.scrubTo(5_000);
    controller.resumeSale();
    expect(useSimulationStore.getState()).toMatchObject({ phase: 'running', replayAtMs: null });
  });

  it('lets a finished sale be scrubbed without touching the worker', () => {
    const worker = start();
    worker.emit({
      type: 'batch',
      seatChanges: new Uint32Array(),
      changeTicks: new Uint32Array(),
      soldOutSections: [],
      samples: [],
      stats: statsAt(60_000, { finished: true }),
      viewer: IDLE_VIEWER,
      viewerRejected: [],
    });
    const sent = worker.sent.length;
    controller.scrubTo(1_000);
    expect(worker.sent.length).toBe(sent);
    expect(useSimulationStore.getState().replayAtMs).toBe(1_000);
  });

  it('joins and leaves the waiting room, restarting a finished sale for a newcomer', () => {
    const worker = start();
    useSimulationStore.setState({ phase: 'finished' });
    controller.joinQueue();
    expect(worker.types().slice(-1)).toEqual(['viewerJoin']);
    expect(useSimulationStore.getState().phase).toBe('running');

    useVenueStore.setState({ selectedSeats: new Set([ids[0] ?? '']) });
    controller.leaveQueue();
    expect(worker.types().slice(-1)).toEqual(['viewerLeave']);
    expect(useVenueStore.getState().selectedSeats.size).toBe(0);
    // Joining a sale that is merely paused leaves it paused.
    useSimulationStore.setState({ phase: 'paused' });
    controller.joinQueue();
    expect(useSimulationStore.getState().phase).toBe('paused');
  });

  it('tells the engine what the viewer holds, buys and drops', () => {
    const worker = start();
    const sync = (selected: string[], sold: string[] = []) => {
      controller.syncViewerSeats(new Set(selected), new Set(sold), indexById);
    };
    sync([ids[0] ?? '', ids[1] ?? '']);
    expect(worker.sent.at(-1)).toEqual({ type: 'viewerHold', seats: [0, 1] });
    sync([ids[0] ?? '', ids[1] ?? '']);
    expect(worker.sent.filter((m) => m.type === 'viewerHold')).toHaveLength(1);

    sync([ids[0] ?? ''], []);
    expect(worker.sent.at(-1)).toEqual({ type: 'viewerRelease', seats: [1] });
    sync([], [ids[0] ?? '']);
    expect(worker.sent.at(-1)).toEqual({ type: 'viewerBuy', seats: [0] });
    sync(['no-such-seat']);
    expect(worker.sent.at(-1)).toEqual({ type: 'viewerHold', seats: [] });
  });

  it('takes a seat back from the selection when someone else got it first', () => {
    const worker = start();
    useVenueStore.setState({
      selectedSeats: new Set([ids[2] ?? '']),
      selectionExpiresAt: Date.now() + 1000,
    });
    controller.syncViewerSeats(new Set([ids[2] ?? '']), new Set(), indexById);
    worker.emit({
      type: 'batch',
      seatChanges: new Uint32Array(),
      changeTicks: new Uint32Array(),
      soldOutSections: [],
      samples: [],
      stats: statsAt(100),
      viewer: IDLE_VIEWER,
      viewerRejected: [2, 9999],
    });
    expect(useVenueStore.getState().selectedSeats.size).toBe(0);
    expect(useVenueStore.getState().feedback?.message).toBe('Someone else got that seat first.');

    // An empty rejection list is a quiet batch.
    useVenueStore.setState({ feedback: null });
    worker.emit({
      type: 'batch',
      seatChanges: new Uint32Array(),
      changeTicks: new Uint32Array(),
      soldOutSections: [],
      samples: [],
      stats: statsAt(200),
      viewer: IDLE_VIEWER,
      viewerRejected: [],
    });
    expect(useVenueStore.getState().feedback).toBeNull();
  });
});

describe('ViewerRuntime', () => {
  const admitted: ViewerState = { ...IDLE_VIEWER, stage: 'admitted' };

  it('holds, pays for and releases seats in the engine as the booking UI changes', () => {
    controller.startSale(venue);
    const worker = FakeWorker.latest();
    worker.emit({
      type: 'ready',
      seatStatus: new Uint8Array(ids.length),
      stats: statsAt(0),
      viewer: admitted,
    });
    render(<ViewerRuntime />);

    act(() => {
      useVenueStore.setState({ selectedSeats: new Set([ids[0] ?? '', ids[1] ?? '']) });
    });
    expect(worker.sent.at(-1)).toEqual({ type: 'viewerHold', seats: [0, 1] });

    act(() => {
      useVenueStore.setState({ selectedSeats: new Set([ids[0] ?? '']) });
    });
    expect(worker.sent.at(-1)).toEqual({ type: 'viewerRelease', seats: [1] });

    act(() => {
      useVenueStore.setState({ selectedSeats: new Set(), soldSeats: new Set([ids[0] ?? '']) });
    });
    expect(worker.sent.at(-1)).toEqual({ type: 'viewerBuy', seats: [0] });
  });

  it('clears a selection made when the viewer is not allowed one, with the reason', () => {
    controller.startSale(venue);
    const worker = FakeWorker.latest();
    worker.emit({
      type: 'ready',
      seatStatus: new Uint8Array(ids.length),
      stats: statsAt(0),
      viewer: IDLE_VIEWER,
    });
    useVenueStore.setState({ selectedSeats: new Set([ids[0] ?? '']) });
    render(<ViewerRuntime />);

    expect(useVenueStore.getState().selectedSeats.size).toBe(0);
    expect(useVenueStore.getState().feedback?.message).toMatch(/Join the waiting room/);
    expect(worker.types()).not.toContain('viewerHold');
  });

  it('leaves held seats alone while a replay is on screen and reconciles on return', () => {
    controller.startSale(venue);
    const worker = FakeWorker.latest();
    worker.emit({
      type: 'ready',
      seatStatus: new Uint8Array(ids.length),
      stats: statsAt(60_000),
      viewer: admitted,
    });
    useSimulationStore
      .getState()
      .applyBatches([makeBatch(statsAt(60_000), { viewer: admitted })], 0);
    render(<ViewerRuntime />);
    act(() => {
      useVenueStore.setState({ selectedSeats: new Set([ids[3] ?? '']) });
    });
    const holds = worker.types().filter((t) => t === 'viewerHold').length;

    act(() => {
      useSimulationStore.getState().setReplayAt(1_000);
    });
    act(() => {
      useVenueStore.setState({ selectedSeats: new Set() });
    });
    expect(worker.types().filter((t) => t === 'viewerRelease')).toHaveLength(0);

    act(() => {
      useSimulationStore.getState().setReplayAt(null);
    });
    expect(worker.sent.at(-1)).toEqual({ type: 'viewerRelease', seats: [3] });
    expect(holds).toBe(1);
  });

  it('does nothing when there is no sale', () => {
    render(<ViewerRuntime />);
    act(() => {
      useVenueStore.setState({ selectedSeats: new Set([ids[0] ?? '']) });
    });
    expect(useVenueStore.getState().selectedSeats.size).toBe(1);
  });
});

describe('picking a seat during a sale', () => {
  it('is refused with the reason until the viewer is admitted', async () => {
    const user = userEvent.setup();
    startRun();
    render(
      <svg>
        <Seats rows={firstRow} />
      </svg>,
    );
    await user.click(document.getElementById(`seat-${ids[4]}`) ?? document.body);
    expect(useVenueStore.getState().selectedSeats.size).toBe(0);
    expect(useVenueStore.getState().feedback?.message).toMatch(/Join the waiting room/);
  });

  it('works as normal once admitted', async () => {
    const user = userEvent.setup();
    startRun({ ...IDLE_VIEWER, stage: 'admitted' });
    render(
      <svg>
        <Seats rows={firstRow} />
      </svg>,
    );
    await user.click(document.getElementById(`seat-${ids[4]}`) ?? document.body);
    expect(useVenueStore.getState().selectedSeats.has(ids[4] ?? '')).toBe(true);
  });
});

describe('SaleTopBar', () => {
  it('stays out of the way until a sale starts', () => {
    const { container } = render(<SaleTopBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the waiting room and lets a viewer join', async () => {
    const user = userEvent.setup();
    controller.startSale(venue);
    const worker = FakeWorker.latest();
    worker.emit({
      type: 'ready',
      seatStatus: new Uint8Array(ids.length),
      stats: statsAt(30_000, { queueLength: 4_000 }),
      viewer: IDLE_VIEWER,
    });
    render(<SaleTopBar />);

    expect(screen.getByText(/4,000 in\s+queue/)).toBeInTheDocument();
    expect(screen.getByText(/new arrivals wait about/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Join the waiting room' }));
    expect(worker.types().slice(-1)).toEqual(['viewerJoin']);
  });

  it('shows the viewer’s place and estimated wait, scaled to the playback speed', () => {
    startRun({ ...IDLE_VIEWER, stage: 'queued', position: 800, etaMs: 20_000 });
    useSimulationStore.setState({
      speed: 10,
      viewer: { ...IDLE_VIEWER, stage: 'queued', position: 800, etaMs: 20_000 },
    });
    render(<SaleTopBar />);
    expect(screen.getByText(/You are #800/)).toHaveTextContent('about 2s');
    expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join the waiting room' })).not.toBeInTheDocument();
  });

  it('says so when the viewer is in, locked out, or admission is paused', () => {
    startRun();
    useSimulationStore.setState({ viewer: { ...IDLE_VIEWER, stage: 'admitted' } });
    const { rerender } = render(<SaleTopBar />);
    expect(screen.getByText(/Your turn/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave sale' })).toBeInTheDocument();

    act(() => {
      useSimulationStore.setState({ viewer: { ...IDLE_VIEWER, stage: 'turned-away' } });
    });
    rerender(<SaleTopBar />);
    expect(screen.getByText('Sold out before your turn')).toBeInTheDocument();

    act(() => {
      useSimulationStore.setState({
        viewer: IDLE_VIEWER,
        stats: statsAt(60_000, {
          seats: { total: 16, available: 0, held: 5, sold: 5, reserved: 0 },
        }),
        series: [],
      });
    });
    expect(screen.getByText(/paused: every seat is held/)).toBeInTheDocument();
  });

  it('cannot join a finished sale or while watching a replay', () => {
    startRun();
    useSimulationStore.setState({ phase: 'finished' });
    render(<SaleTopBar />);
    expect(screen.getByRole('button', { name: 'Join the waiting room' })).toBeDisabled();
  });

  it('has a timeline you can drag to replay, and a button back to live', () => {
    startRun();
    render(<SaleTopBar />);
    const slider = screen.getByRole('slider', { name: 'Timeline' });
    expect(slider).toHaveValue('60000');
    expect(slider).toHaveAttribute('aria-valuetext', '01:00 of 01:00');
    expect(screen.getByText('Live')).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: '12300' } });
    expect(useSimulationStore.getState().replayAtMs).toBe(12_300);
    expect(screen.getByText('00:12 / 01:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go live' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join the waiting room' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Go live' }));
    expect(useSimulationStore.getState().replayAtMs).toBeNull();
  });

  it('labels the timeline by what the sale is doing', () => {
    startRun();
    useSimulationStore.setState({ phase: 'paused' });
    const { rerender } = render(<SaleTopBar />);
    expect(screen.getByText('Paused')).toBeInTheDocument();
    act(() => {
      useSimulationStore.setState({ phase: 'finished' });
    });
    rerender(<SaleTopBar />);
    expect(screen.getByText('Ended')).toBeInTheDocument();
  });
});
