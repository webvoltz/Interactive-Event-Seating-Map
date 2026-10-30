import type { Venue } from '../interfaces/venue.interfaces';
import { serializeConfig } from './config';
import type { SimSpeed, WorkerCommand, WorkerEvent } from './protocol';
import { buildSeatIdList } from './seatBook';
import { useSimulationStore, type SimBatch } from './simulationStore';

let worker: Worker | null = null;
let pending: SimBatch[] = [];
let frame = 0;
let startAfterReady = false;
let activeVenue: Venue | null = null;

function send(command: WorkerCommand): void {
  worker?.postMessage(command);
}

function flush(): void {
  frame = 0;
  if (pending.length === 0) return;
  const batches = pending;
  pending = [];
  useSimulationStore.getState().applyBatches(batches, performance.now());
}

function onWorkerEvent(event: MessageEvent<WorkerEvent>): void {
  const message = event.data;
  const store = useSimulationStore.getState();
  if (message.type === 'ready') {
    if (!activeVenue) return;
    const ids = buildSeatIdList(activeVenue);
    const indexById = new Map<string, number>();
    ids.forEach((id, i) => indexById.set(id, i));
    store.beginRun(
      message.seatStatus,
      indexById,
      activeVenue.sections.map((s) => s.label),
      message.stats,
    );
    if (startAfterReady) {
      startAfterReady = false;
      store.setPhase('running');
      send({ type: 'speed', speed: store.speed });
      send({ type: 'start' });
    }
    return;
  }

  pending.push({
    seatChanges: message.seatChanges,
    soldOutSections: message.soldOutSections,
    samples: message.samples,
    stats: message.stats,
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
  syncUrl();
  ensureWorker();
  startAfterReady = true;
  send({ type: 'init', venue, config: store.config });
}

export function pauseSale(): void {
  send({ type: 'pause' });
  useSimulationStore.getState().setPhase('paused');
}

export function resumeSale(): void {
  send({ type: 'resume' });
  useSimulationStore.getState().setPhase('running');
}

export function setSaleSpeed(speed: SimSpeed): void {
  useSimulationStore.getState().setSpeed(speed);
  send({ type: 'speed', speed });
}

export function resetSale(): void {
  worker?.terminate();
  worker = null;
  pending = [];
  startAfterReady = false;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  useSimulationStore.getState().clearRun();
}
