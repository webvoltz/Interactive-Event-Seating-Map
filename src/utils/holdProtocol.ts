import type { HoldMap, HoldMessage, SeatHold, WireHold } from '../interfaces/venue.interfaces';

export const SELECTION_HOLD_MS = 5 * 60_000;
export const SIM_WINDOW_MS = 6 * 60_000;
// Quantized so hundreds of holds collapse into a handful of release batches.
export const RELEASE_TICK_MS = 4_000;
export const EXPIRY_SLACK_MS = 50;
export const SYNC_TIMEOUT_MS = 250;
export const CLOCK_SKEW_TOLERANCE_MS = 2_000;
// Versioned so a protocol change can't cross-talk with an old, unreloaded tab.
export const HOLD_CHANNEL_NAME = 'venue-holds-v1';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isWireHold(value: unknown): value is WireHold {
  return (
    typeof value === 'object' &&
    value !== null &&
    'seatId' in value &&
    'owner' in value &&
    'expiresAt' in value &&
    typeof value.seatId === 'string' &&
    typeof value.owner === 'string' &&
    typeof value.expiresAt === 'number'
  );
}

function isWireHoldArray(value: unknown): value is WireHold[] {
  return Array.isArray(value) && value.every(isWireHold);
}

export function isHoldMessage(data: unknown): data is HoldMessage {
  if (typeof data !== 'object' || data === null) return false;
  if (!('type' in data) || !('from' in data) || !('sentAt' in data)) return false;
  if (typeof data.type !== 'string' || typeof data.from !== 'string') return false;
  if (typeof data.sentAt !== 'number') return false;

  switch (data.type) {
    case 'hello':
      return 'ownedSeatIds' in data && isStringArray(data.ownedSeatIds);
    case 'state':
      return (
        'to' in data &&
        'holds' in data &&
        typeof data.to === 'string' &&
        isWireHoldArray(data.holds)
      );
    case 'hold':
      return (
        'seatIds' in data &&
        'expiresAt' in data &&
        isStringArray(data.seatIds) &&
        typeof data.expiresAt === 'number'
      );
    case 'sold':
      return 'seatIds' in data && isStringArray(data.seatIds);
    case 'goodbye':
      return true;
    default:
      return false;
  }
}

export function translateExpiry(expiresAt: number, sentAt: number, receivedAt: number): number {
  const skew = receivedAt - sentAt;
  if (Math.abs(skew) <= CLOCK_SKEW_TOLERANCE_MS) return expiresAt;
  return expiresAt + skew;
}

export function toWireHolds(holds: HoldMap): WireHold[] {
  return Array.from(holds.values(), (hold) => ({
    seatId: hold.seatId,
    owner: hold.owner,
    expiresAt: hold.expiresAt,
  }));
}

// Returns the SAME map reference when nothing lapsed - callers rely on this to skip a re-render.
export function pruneHolds(holds: HoldMap, now: number): HoldMap {
  let changed = false;
  const next = new Map<string, SeatHold>();
  for (const [seatId, hold] of holds) {
    if (hold.expiresAt > now) {
      next.set(seatId, hold);
    } else {
      changed = true;
    }
  }
  return changed ? next : holds;
}

// null means nothing to schedule.
export function nextDeadline(holds: HoldMap, selectionExpiresAt: number | null): number | null {
  let min = selectionExpiresAt;
  for (const hold of holds.values()) {
    if (min === null || hold.expiresAt < min) min = hold.expiresAt;
  }
  return min;
}

export interface PeerHoldResult {
  holds: HoldMap;
  lostSeatIds: string[];
  mustRepost: boolean;
}

// `message.seatIds` is the sender's entire current claim, so this fully
// replaces (not merges) whatever was previously attributed to that sender.
// A seat both sides claim is resolved by lower-session-id-wins.
export function ingestPeerHold(
  holds: HoldMap,
  selectedSeats: ReadonlySet<string>,
  mySessionId: string,
  message: { from: string; seatIds: readonly string[]; expiresAt: number },
): PeerHoldResult {
  if (message.from === mySessionId) {
    return { holds, lostSeatIds: [], mustRepost: false };
  }

  const next = new Map(holds);
  for (const [seatId, hold] of next) {
    if (hold.owner === message.from) next.delete(seatId);
  }

  const lostSeatIds: string[] = [];
  let mustRepost = false;

  for (const seatId of message.seatIds) {
    if (selectedSeats.has(seatId)) {
      if (message.from < mySessionId) {
        next.set(seatId, { seatId, owner: message.from, expiresAt: message.expiresAt });
        lostSeatIds.push(seatId);
      } else {
        mustRepost = true;
      }
    } else {
      next.set(seatId, { seatId, owner: message.from, expiresAt: message.expiresAt });
    }
  }

  return { holds: next, lostSeatIds, mustRepost };
}

// A join-time `state` reply is authoritative (no tie-break, unlike `hold`).
export function adoptRemoteState(
  selectedSeats: ReadonlySet<string>,
  mySessionId: string,
  snapshot: readonly WireHold[],
): { holds: HoldMap; lostSeatIds: string[] } {
  const next = new Map<string, SeatHold>();
  const lostSeatIds: string[] = [];

  for (const wire of snapshot) {
    if (wire.owner === mySessionId) continue;
    next.set(wire.seatId, { seatId: wire.seatId, owner: wire.owner, expiresAt: wire.expiresAt });
    if (selectedSeats.has(wire.seatId)) lostSeatIds.push(wire.seatId);
  }

  return { holds: next, lostSeatIds };
}
