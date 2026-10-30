import { MAX_GROUP_SIZE } from './config';

// The detector looks at behaviour, never at who someone "is". Each rule alone can fire on a real,
// unlucky human; blocking needs two to agree, so an ordinary buyer is never caught by one slip.
export const DETECTION = {
  // A search this soon after the identity's previous action (or after being let in) is faster than a
  // person can look at a seat map.
  FAST_ACTION_MS: 150,
  FAST_ACTIONS_TO_FLAG: 2,
  // One identity holding or buying more than one booking's worth of seats.
  MAX_SEATS_PER_IDENTITY: MAX_GROUP_SIZE,
  // The same request (same party size) fired again and again in quick succession.
  SAME_SHAPE_STREAK: 3,
  SAME_SHAPE_GAP_MS: 1_000,
  RULES_TO_BLOCK: 2,
  // The rules run as a periodic sweep over identities that acted since the last one, not per click.
  SCAN_MS: 200,
} as const;

export type RuleName = 'speed' | 'seats' | 'pattern';

export interface RuleSignals {
  speed: boolean;
  seats: boolean;
  pattern: boolean;
}

export function countSignals(signals: RuleSignals): number {
  return Number(signals.speed) + Number(signals.seats) + Number(signals.pattern);
}

// Per-identity behaviour log: a few typed arrays, so tracking 20,000+ identities stays cheap.
export class IdentityTracker {
  private readonly lastActionAt: Float64Array;
  private readonly lastSize: Uint8Array;
  private readonly fastActions: Uint16Array;
  private readonly streak: Uint16Array;
  private readonly seatsClaimed: Uint16Array;
  private readonly seen: Uint8Array;
  private readonly dirtyFlag: Uint8Array;
  private dirty: number[] = [];

  constructor(identities: number) {
    this.lastActionAt = new Float64Array(identities).fill(-1);
    this.lastSize = new Uint8Array(identities);
    this.fastActions = new Uint16Array(identities);
    this.streak = new Uint16Array(identities);
    this.seatsClaimed = new Uint16Array(identities);
    this.seen = new Uint8Array(identities);
    this.dirtyFlag = new Uint8Array(identities);
  }

  // One search by `id` for `partySize` seats. `admittedAt` anchors the identity's very first action.
  noteAction(id: number, now: number, partySize: number, admittedAt: number): void {
    const previous = this.lastActionAt[id] ?? -1;
    const gap = previous >= 0 ? now - previous : now - admittedAt;
    if (gap < DETECTION.FAST_ACTION_MS) this.fastActions[id] = (this.fastActions[id] ?? 0) + 1;

    const repeats =
      this.seen[id] === 1 && this.lastSize[id] === partySize && gap < DETECTION.SAME_SHAPE_GAP_MS;
    this.streak[id] = repeats ? (this.streak[id] ?? 0) + 1 : 1;

    this.seen[id] = 1;
    this.lastSize[id] = partySize;
    this.lastActionAt[id] = now;
    this.markDirty(id);
  }

  addSeats(id: number, count: number): void {
    this.seatsClaimed[id] = (this.seatsClaimed[id] ?? 0) + count;
    this.markDirty(id);
  }

  signals(id: number): RuleSignals {
    return {
      speed: (this.fastActions[id] ?? 0) >= DETECTION.FAST_ACTIONS_TO_FLAG,
      seats: (this.seatsClaimed[id] ?? 0) > DETECTION.MAX_SEATS_PER_IDENTITY,
      pattern: (this.streak[id] ?? 0) >= DETECTION.SAME_SHAPE_STREAK,
    };
  }

  // Identities that did something since the last call, for the periodic sweep.
  takeDirty(): number[] {
    const ids = this.dirty;
    this.dirty = [];
    for (const id of ids) this.dirtyFlag[id] = 0;
    return ids;
  }

  private markDirty(id: number): void {
    if (this.dirtyFlag[id] === 1) return;
    this.dirtyFlag[id] = 1;
    this.dirty.push(id);
  }
}
