import type { Venue } from '../interfaces/venue.interfaces';
import { useVenueStore } from '../store/seatStore';
import { serializeConfig } from './config';
import type { SimSpeed, WorkerCommand, WorkerEvent } from './protocol';
import { buildSeatIdList } from './seatBook';
import { useSimulationStore, type SimBatch } from './simulationStore';

let worker: Worker | null = null;
let comparisonWorker: Worker | null = null;
let pending: SimBatch[] = [];
let frame = 0;
let startAfterReady = false;
let activeVenue: Venue | null = null;
let seatIds: readonly string[] = [];
// Set when scrubbing paused a running sale, so returning to live can resume it.
let pausedForReplay = false;
// Seats the viewer has asked the engine to hold (confirmed or in flight).
const requested = new Set<string>();

export function send(command: WorkerCommand): void {
  worker?.postMessage(command);
}

function flush(): void {
  frame = 0;
  if (pending.length === 0) return;
  const batches = pending;
  pending = [];
  useSimulationStore.getState().applyBatches(batches, performance.now());
}

function dropRejected(indices: readonly number[]): void {
  const ids = indices.map((i) => seatIds[i]).filter((id): id is string => id !== undefined);
  if (ids.length === 0) return;
  for (const id of ids) requested.delete(id);
  useVenueStore.getState().releaseLostSeats(ids, 'Someone else got that seat first.');
}

function onWorkerEvent(event: MessageEvent<WorkerEvent>): void {
  const message = event.data;
  // Comparison messages belong to their own worker; they never come from the live sale's.
  if (message.type === 'comparison' || message.type === 'comparisonProgress') return;
  const store = useSimulationStore.getState();
  if (message.type === 'ready') {
    if (!activeVenue) return;
    seatIds = buildSeatIdList(activeVenue);
    const indexById = new Map<string, number>();
    seatIds.forEach((id, i) => indexById.set(id, i));
    store.beginRun(
      message.seatStatus,
      indexById,
      activeVenue.sections.map((s) => s.label),
      message.stats,
      message.viewer,
    );
    if (startAfterReady) {
      startAfterReady = false;
      store.setPhase('running');
      send({ type: 'speed', speed: store.speed });
      send({ type: 'start' });
    }
    return;
  }

  dropRejected(message.viewerRejected);
  pending.push({
    seatChanges: message.seatChanges,
    changeTicks: message.changeTicks,
    soldOutSections: message.soldOutSections,
    samples: message.samples,
    stats: message.stats,
    viewer: message.viewer,
  });
  // One merge per animation frame, however many batches arrived since the last.
  frame ||= requestAnimationFrame(flush);
}

// The sale's settings live in the URL so a shared link replays the same sale.
export function syncUrl(): void {
  const { config } = useSimulationStore.getState();
  const url = new URL(window.location.href);
  url.search = serializeConfig(config);
  window.history.replaceState(null, '', url);
}

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = onWorkerEvent;
  }
  return worker;
}

export function startSale(venue: Venue): void {
  const store = useSimulationStore.getState();
  activeVenue = venue;
  requested.clear();
  pausedForReplay = false;
  syncUrl();
  ensureWorker();
  startAfterReady = true;
  send({ type: 'init', venue, config: store.config });
}

export function pauseSale(): void {
  send({ type: 'pause' });
  useSimulationStore.getState().setPhase('paused');
}

// Back to the present: show the live board again, and carry on if scrubbing was what paused it.
export function goLive(): void {
  const store = useSimulationStore.getState();
  store.setReplayAt(null);
  if (pausedForReplay) {
    pausedForReplay = false;
    send({ type: 'resume' });
    store.setPhase('running');
  }
}

export function resumeSale(): void {
  const store = useSimulationStore.getState();
  if (store.replayAtMs !== null) store.setReplayAt(null);
  pausedForReplay = false;
  send({ type: 'resume' });
  store.setPhase('running');
}

// Dragging the timeline: a running sale is held still so the board you scrub is the board you see.
export function scrubTo(ms: number): void {
  const store = useSimulationStore.getState();
  if (store.phase === 'running') {
    send({ type: 'pause' });
    store.setPhase('paused');
    pausedForReplay = true;
  }
  store.setReplayAt(ms);
  if (useSimulationStore.getState().replayAtMs === null) goLive();
}

export function setSaleSpeed(speed: SimSpeed): void {
  useSimulationStore.getState().setSpeed(speed);
  send({ type: 'speed', speed });
}

export function joinQueue(): void {
  send({ type: 'viewerJoin' });
  const { phase, setPhase } = useSimulationStore.getState();
  if (phase === 'finished') setPhase('running');
}

export function leaveQueue(): void {
  send({ type: 'viewerLeave' });
  requested.clear();
  useVenueStore.getState().clearSelection();
}

// Keeps the engine's idea of the viewer's seats in step with the booking UI's selection.
export function syncViewerSeats(
  selected: ReadonlySet<string>,
  sold: ReadonlySet<string>,
  indexById: ReadonlyMap<string, number>,
): void {
  const toIndices = (ids: Iterable<string>) =>
    Array.from(ids, (id) => indexById.get(id)).filter((i): i is number => i !== undefined);

  const added = Array.from(selected).filter((id) => !requested.has(id));
  const dropped = Array.from(requested).filter((id) => !selected.has(id));
  for (const id of added) requested.add(id);
  for (const id of dropped) requested.delete(id);

  if (added.length > 0) send({ type: 'viewerHold', seats: toIndices(added) });
  // Seats that left the selection because they were paid for are sold, not released.
  const paid = dropped.filter((id) => sold.has(id));
  const released = dropped.filter((id) => !sold.has(id));
  if (paid.length > 0) send({ type: 'viewerBuy', seats: toIndices(paid) });
  if (released.length > 0) send({ type: 'viewerRelease', seats: toIndices(released) });
}

export function resetSale(): void {
  worker?.terminate();
  worker = null;
  pending = [];
  startAfterReady = false;
  pausedForReplay = false;
  requested.clear();
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  useSimulationStore.getState().clearRun();
}

// Plays the current settings' sale twice in a worker of its own (detector off, then on), so the live
// sale, if any, keeps running untouched.
export function runDetectionComparison(venue: Venue): void {
  const { config, setComparison } = useSimulationStore.getState();
  cancelComparison();
  const runner = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
  comparisonWorker = runner;
  setComparison({ status: 'running', finished: 0 });
  runner.onmessage = (event: MessageEvent<WorkerEvent>) => {
    const message = event.data;
    if (message.type === 'comparisonProgress') {
      setComparison({ status: 'running', finished: message.finished });
    } else if (message.type === 'comparison') {
      setComparison({ status: 'done', result: message.result });
      cancelComparison();
    }
  };
  runner.postMessage({ type: 'compare', venue, config });
}

export function cancelComparison(): void {
  comparisonWorker?.terminate();
  comparisonWorker = null;
}

export function dismissComparison(): void {
  cancelComparison();
  useSimulationStore.getState().setComparison({ status: 'idle' });
}
