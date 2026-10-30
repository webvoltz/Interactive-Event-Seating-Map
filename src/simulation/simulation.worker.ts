import type { Venue } from '../interfaces/venue.interfaces';
import type { SimConfig } from './config';
import { SimulationEngine } from './engine';
import { pump, type PacerState } from './pacer';
import type { SimSpeed, WorkerCommand, WorkerEvent } from './protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerCommand>) => void) | null;
  postMessage: (message: WorkerEvent, transfer: Transferable[]) => void;
}

function isWorkerScope(value: unknown): value is WorkerScope {
  return typeof value === 'object' && value !== null && 'postMessage' in value;
}

if (!isWorkerScope(self)) throw new Error('simulation.worker must run inside a Worker');
const scope = self;

// About ten UI updates a second.
const BATCH_INTERVAL_MS = 100;
const WALL_BUDGET_MS = 70;

let venue: Venue | null = null;
let engine: SimulationEngine | null = null;
let speed: SimSpeed = 1;
let timer: ReturnType<typeof setInterval> | null = null;
let lastWall = 0;
const pacer: PacerState = { owedSimMs: 0 };

function stop(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

function build(config: SimConfig): void {
  stop();
  if (!venue) return;
  engine = new SimulationEngine(venue, config);
  pacer.owedSimMs = 0;
  const seatStatus = engine.statusSnapshot();
  scope.postMessage({ type: 'ready', seatStatus, stats: engine.getStats() }, [seatStatus.buffer]);
}

function emitBatch(): void {
  if (!engine) return;
  const { seatChanges, soldOutSections, samples } = engine.drainDelta();
  scope.postMessage(
    { type: 'batch', seatChanges, soldOutSections, samples, stats: engine.getStats() },
    [seatChanges.buffer],
  );
}

function step(): void {
  if (!engine) return;
  const wallNow = performance.now();
  const deadline = wallNow + WALL_BUDGET_MS;
  pump(
    engine,
    pacer,
    Math.min(wallNow - lastWall, 250),
    speed,
    () => performance.now() >= deadline,
  );
  lastWall = wallNow;
  emitBatch();
  if (engine.finished) stop();
}

function run(): void {
  stop();
  lastWall = performance.now();
  timer = setInterval(step, BATCH_INTERVAL_MS);
}

function isWorkerCommand(data: unknown): data is WorkerCommand {
  return (
    typeof data === 'object' && data !== null && 'type' in data && typeof data.type === 'string'
  );
}

scope.onmessage = (event: MessageEvent) => {
  const command: unknown = event.data;
  if (!isWorkerCommand(command)) return;
  switch (command.type) {
    case 'init':
      venue = command.venue;
      build(command.config);
      break;
    case 'reset':
      build(command.config);
      break;
    case 'start':
    case 'resume':
      if (engine && !engine.finished) run();
      break;
    case 'pause':
      stop();
      break;
    case 'speed':
      speed = command.speed;
      break;
  }
};
