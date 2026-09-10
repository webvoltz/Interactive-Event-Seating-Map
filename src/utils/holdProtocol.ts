import type { HoldMap, HoldMessage, SeatHold, WireHold } from '../interfaces/venue.interfaces';

// How long a live cart holds its seats before checkout must complete.
export const SELECTION_HOLD_MS = 5 * 60_000;
// The window the seeded demo holds (venue.json's static `held` seats) are
// spread across, so they visibly release over the life of a session instead
// of all at once or never.
export const SIM_WINDOW_MS = 6 * 60_000;
// Expiries are quantized to this grid so hundreds of holds collapse into a
// handful of release batches - one store write per batch, not one per seat.
export const RELEASE_TICK_MS = 4_000;
// The expiry timer fires just after (never just before) the deadline.
export const EXPIRY_SLACK_MS = 50;
// How long a newly-mounted tab waits for an incumbent's `state` reply before
// seeding its own simulation.
export const SYNC_TIMEOUT_MS = 250;
// A cross-tab deadline is shifted by the sender/receiver clock difference
// only once it exceeds this - small jitter shouldn't perturb every message.
export const CLOCK_SKEW_TOLERANCE_MS = 2_000;
// Versioned so a future protocol change can't cross-talk with an old tab
// that hasn't reloaded yet.
export const HOLD_CHANNEL_NAME = 'venue-holds-v1';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

// `in` narrows a plain `object` without ever casting it - the same idiom
// seatStore.ts's isPersistedStorageValue already uses for the same reason:
// this is deserializing a shared-origin channel another app could also be
// posting to, so nothing about its shape can be assumed.
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

// Validates payloads coming off a shared-origin BroadcastChannel, which
// another app on the same origin could also be posting to - and is what
// lets `event.data` (typed `unknown`) be treated as a HoldMessage safely.
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

// Deadlines are exchanged as absolute epoch ms, so a mid-session system
// clock change (NTP correction, a user editing the clock) is the only real
// skew risk between tabs on one machine - small jitter is left alone so it
// doesn't perturb every message for no reason.
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

// Drops every hold whose deadline has passed. Returns the SAME map
// reference when nothing lapsed - load-bearing, not a micro-optimisation:
// callers use this to decide whether a store write (and therefore a
// ~1,500-seat re-render) is needed at all.
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

// The next moment anything in this tab needs to change: whichever is
// sooner, a tracked hold lapsing or the local checkout timer running out.
// null means "nothing to schedule" - no timer should be armed.
export function nextDeadline(holds: HoldMap, selectionExpiresAt: number | null): number | null {
  let min = selectionExpiresAt;
  for (const hold of holds.values()) {
    if (min === null || hold.expiresAt < min) min = hold.expiresAt;
  }
  return min;
}

export interface PeerHoldResult {
  holds: HoldMap;
  // Seats this tab was holding in its own selection that it must now give
  // up, because a peer's claim on them won a tie-break.
  lostSeatIds: string[];
  // This tab won a conflict on at least one seat - it should re-broadcast
  // its own hold so the losing peer learns and yields.
  mustRepost: boolean;
}

// Applies a peer's `hold` (or `goodbye`, which is just seatIds: []) to the
// local hold map. `hold` always carries the sender's ENTIRE current claim,
// so this first clears every hold previously attributed to that sender
// (full-set replacement - a dropped message self-heals on the next change
// instead of leaving a stale hold forever), then inserts the new set.
//
// A seat the sender claims that I also have selected is a genuine
// simultaneous-selection race with no server to arbitrate it - resolved by
// a deterministic total order (lower session id wins) that both tabs
// compute identically with no coordinator.
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

// A join-time `state` reply is authoritative, unlike an ordinary `hold`:
// the incumbent genuinely had the seat first, so no tie-break is applied -
// I simply lose any overlapping seat from my own selection.
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
