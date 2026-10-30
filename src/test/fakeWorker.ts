import type { WorkerCommand, WorkerEvent } from '../simulation/protocol';

// A Worker stand-in that records what the page sends and lets a test play the worker's side.
export class FakeWorker {
  static instances: FakeWorker[] = [];

  static latest(): FakeWorker {
    const worker = FakeWorker.instances.at(-1);
    if (!worker) throw new Error('no worker has been created');
    return worker;
  }

  onmessage: ((event: MessageEvent<WorkerEvent>) => void) | null = null;
  sent: WorkerCommand[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: WorkerCommand) {
    this.sent.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(event: WorkerEvent) {
    this.onmessage?.(new MessageEvent('message', { data: event }));
  }

  types(): string[] {
    return this.sent.map((m) => m.type);
  }
}
