export interface TimedEvent {
  time: number;
  buyer: number;
  kind: number;
}

interface Entry extends TimedEvent {
  seq: number;
}

// Min-heap ordered by (time, insertion order), so events at the same instant run in a stable order.
export class EventQueue {
  private readonly heap: Entry[] = [];
  private seq = 0;

  get size(): number {
    return this.heap.length;
  }

  peekTime(): number | null {
    return this.heap[0]?.time ?? null;
  }

  push(time: number, buyer: number, kind: number): void {
    const heap = this.heap;
    const entry: Entry = { time, buyer, kind, seq: this.seq++ };
    let i = heap.length;
    heap.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const p = heap[parent];
      if (!p || !EventQueue.before(entry, p)) break;
      heap[i] = p;
      i = parent;
    }
    heap[i] = entry;
  }

  pop(): TimedEvent | undefined {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop();
    if (!top || !last) return undefined;
    if (heap.length > 0) {
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= heap.length) break;
        const right = left + 1;
        let child = left;
        const l = heap[left];
        const r = heap[right];
        if (l && r && EventQueue.before(r, l)) child = right;
        const c = heap[child];
        if (!c || !EventQueue.before(c, last)) break;
        heap[i] = c;
        i = child;
      }
      heap[i] = last;
    }
    return top;
  }

  private static before(a: Entry, b: Entry): boolean {
    return a.time < b.time || (a.time === b.time && a.seq < b.seq);
  }
}
