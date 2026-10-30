const INITIAL_CAPACITY = 4096;
const STATUS_BITS = 2;
const STATUS_MASK = 0b11;

// Every seat change of a sale, in order, each stamped with the tick it happened on. Replaying a
// prefix of it over the starting board rebuilds the map at that exact moment. Two Uint32s per
// change: a full 20,000-buyer sale is a few hundred thousand entries, i.e. a couple of MB.
export class EventLog {
  private ticks = new Uint32Array(INITIAL_CAPACITY);
  private packed = new Uint32Array(INITIAL_CAPACITY);
  private count = 0;

  get length(): number {
    return this.count;
  }

  get byteLength(): number {
    return this.ticks.byteLength + this.packed.byteLength;
  }

  // `ticks[i]` is when `packed[i]` ((seat << 2) | status) happened; ticks never go backwards.
  append(ticks: Uint32Array, packed: Uint32Array): void {
    const added = Math.min(ticks.length, packed.length);
    if (added === 0) return;
    this.reserve(this.count + added);
    this.ticks.set(ticks.subarray(0, added), this.count);
    this.packed.set(packed.subarray(0, added), this.count);
    this.count += added;
  }

  // How many entries happened on or before `tick`.
  countAt(tick: number): number {
    let low = 0;
    let high = this.count;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((this.ticks[mid] ?? 0) <= tick) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  boardAt(initial: Uint8Array, tick: number): Uint8Array {
    const board = initial.slice();
    const end = this.countAt(tick);
    for (let i = 0; i < end; i++) {
      const entry = this.packed[i] ?? 0;
      board[entry >>> STATUS_BITS] = entry & STATUS_MASK;
    }
    return board;
  }

  private reserve(needed: number): void {
    if (needed <= this.ticks.length) return;
    let capacity = this.ticks.length;
    while (capacity < needed) capacity *= 2;
    const ticks = new Uint32Array(capacity);
    const packed = new Uint32Array(capacity);
    ticks.set(this.ticks.subarray(0, this.count));
    packed.set(this.packed.subarray(0, this.count));
    this.ticks = ticks;
    this.packed = packed;
  }
}
