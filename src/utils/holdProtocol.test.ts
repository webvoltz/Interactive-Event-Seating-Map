import { describe, expect, it } from 'vitest';
import type { HoldMap, SeatHold, WireHold } from '../interfaces/venue.interfaces';
import {
  CLOCK_SKEW_TOLERANCE_MS,
  adoptRemoteState,
  ingestPeerHold,
  isHoldMessage,
  nextDeadline,
  pruneHolds,
  toWireHolds,
  translateExpiry,
} from './holdProtocol';

function holdMap(...holds: SeatHold[]): HoldMap {
  return new Map(holds.map((h) => [h.seatId, h]));
}

describe('isHoldMessage', () => {
  it.each([
    { type: 'hello', from: 'a', sentAt: 1, ownedSeatIds: ['S1'] },
    { type: 'state', from: 'a', sentAt: 1, to: 'b', holds: [] },
    { type: 'hold', from: 'a', sentAt: 1, seatIds: ['S1'], expiresAt: 2 },
    { type: 'sold', from: 'a', sentAt: 1, seatIds: ['S1'] },
    { type: 'goodbye', from: 'a', sentAt: 1 },
  ])('accepts a valid %o message', (message) => {
    expect(isHoldMessage(message)).toBe(true);
  });

  it.each([
    null,
    'a string',
    42,
    {},
    { type: 'hello' }, // missing from/sentAt
    { type: 'bogus', from: 'a', sentAt: 1 },
    { type: 'hold', from: 'a', sentAt: 1, seatIds: 'not-an-array', expiresAt: 1 },
    { type: 'hold', from: 'a', sentAt: 1, seatIds: [1, 2], expiresAt: 1 },
    { type: 'hold', from: 'a', sentAt: 1, seatIds: [], expiresAt: 'not-a-number' },
    { type: 'sold', from: 'a', sentAt: 1 }, // missing seatIds
  ])('rejects %o', (payload) => {
    expect(isHoldMessage(payload)).toBe(false);
  });
});

describe('translateExpiry', () => {
  it('leaves the deadline untouched when skew is within tolerance', () => {
    const sentAt = 1_000;
    const receivedAt = sentAt + CLOCK_SKEW_TOLERANCE_MS;
    expect(translateExpiry(5_000, sentAt, receivedAt)).toBe(5_000);
  });

  it('shifts the deadline forward when the receiver clock is ahead beyond tolerance', () => {
    const sentAt = 1_000;
    const receivedAt = sentAt + CLOCK_SKEW_TOLERANCE_MS + 1;
    expect(translateExpiry(5_000, sentAt, receivedAt)).toBe(5_000 + (CLOCK_SKEW_TOLERANCE_MS + 1));
  });

  it('shifts the deadline backward when the receiver clock is behind beyond tolerance', () => {
    const sentAt = 10_000;
    const receivedAt = sentAt - CLOCK_SKEW_TOLERANCE_MS - 1;
    expect(translateExpiry(5_000, sentAt, receivedAt)).toBe(5_000 - (CLOCK_SKEW_TOLERANCE_MS + 1));
  });
});

describe('pruneHolds', () => {
  it('returns the identical map reference when nothing has lapsed', () => {
    const holds = holdMap({ seatId: 'S1', owner: 'peer', expiresAt: 10_000 });
    expect(pruneHolds(holds, 5_000)).toBe(holds);
  });

  it('drops only the holds that have lapsed', () => {
    const holds = holdMap(
      { seatId: 'S1', owner: 'peer', expiresAt: 1_000 },
      { seatId: 'S2', owner: 'peer', expiresAt: 9_000 },
    );
    const pruned = pruneHolds(holds, 5_000);
    expect(Array.from(pruned.keys())).toEqual(['S2']);
  });

  it('treats expiresAt === now as lapsed (strict > for "still held")', () => {
    const holds = holdMap({ seatId: 'S1', owner: 'peer', expiresAt: 5_000 });
    expect(pruneHolds(holds, 5_000).size).toBe(0);
  });

  it('prunes hundreds of lapsed holds in a single pass (the wake-from-background case)', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      seatId: `S${i}`,
      owner: 'peer',
      expiresAt: 1_000,
    }));
    const holds = holdMap(...many);
    expect(pruneHolds(holds, 5_000).size).toBe(0);
  });
});

describe('nextDeadline', () => {
  it('is null when there is nothing to schedule', () => {
    expect(nextDeadline(holdMap(), null)).toBeNull();
  });

  it('is the minimum across all holds', () => {
    const holds = holdMap(
      { seatId: 'S1', owner: 'peer', expiresAt: 9_000 },
      { seatId: 'S2', owner: 'peer', expiresAt: 3_000 },
    );
    expect(nextDeadline(holds, null)).toBe(3_000);
  });

  it('is the minimum of holds and the local selection deadline', () => {
    const holds = holdMap({ seatId: 'S1', owner: 'peer', expiresAt: 9_000 });
    expect(nextDeadline(holds, 2_000)).toBe(2_000);
  });
});

describe('ingestPeerHold', () => {
  it('inserts a non-conflicting peer hold', () => {
    const result = ingestPeerHold(holdMap(), new Set(), 'me', {
      from: 'peer',
      seatIds: ['S1'],
      expiresAt: 9_000,
    });
    expect(result.holds.get('S1')).toEqual({ seatId: 'S1', owner: 'peer', expiresAt: 9_000 });
    expect(result.lostSeatIds).toEqual([]);
    expect(result.mustRepost).toBe(false);
  });

  it('replaces the full set of a peer’s previous holds rather than merging them', () => {
    const existing = holdMap(
      { seatId: 'S1', owner: 'peer', expiresAt: 1_000 },
      { seatId: 'S2', owner: 'peer', expiresAt: 1_000 },
    );
    const result = ingestPeerHold(existing, new Set(), 'me', {
      from: 'peer',
      seatIds: ['S2', 'S3'],
      expiresAt: 9_000,
    });
    expect(Array.from(result.holds.keys()).sort()).toEqual(['S2', 'S3']);
  });

  it('never touches another owner’s holds', () => {
    const existing = holdMap({ seatId: 'S1', owner: 'other-peer', expiresAt: 1_000 });
    const result = ingestPeerHold(existing, new Set(), 'me', {
      from: 'peer',
      seatIds: [],
      expiresAt: 9_000,
    });
    expect(result.holds.get('S1')?.owner).toBe('other-peer');
  });

  it('a goodbye (empty seatIds) clears exactly that owner’s holds', () => {
    const existing = holdMap(
      { seatId: 'S1', owner: 'peer', expiresAt: 1_000 },
      { seatId: 'S2', owner: 'other-peer', expiresAt: 1_000 },
    );
    const result = ingestPeerHold(existing, new Set(), 'me', {
      from: 'peer',
      seatIds: [],
      expiresAt: 0,
    });
    expect(Array.from(result.holds.keys())).toEqual(['S2']);
  });

  it('refuses a message that claims to be from myself', () => {
    const result = ingestPeerHold(holdMap(), new Set(), 'me', {
      from: 'me',
      seatIds: ['S1'],
      expiresAt: 9_000,
    });
    expect(result.holds.size).toBe(0);
  });

  it('conflict: a lexicographically lower peer id wins - I lose the seat', () => {
    const result = ingestPeerHold(holdMap(), new Set(['S1']), 'zzz', {
      from: 'aaa',
      seatIds: ['S1'],
      expiresAt: 9_000,
    });
    expect(result.lostSeatIds).toEqual(['S1']);
    expect(result.holds.get('S1')?.owner).toBe('aaa');
    expect(result.mustRepost).toBe(false);
  });

  it('conflict: a lexicographically higher peer id loses - I keep the seat and must repost', () => {
    const result = ingestPeerHold(holdMap(), new Set(['S1']), 'aaa', {
      from: 'zzz',
      seatIds: ['S1'],
      expiresAt: 9_000,
    });
    expect(result.lostSeatIds).toEqual([]);
    expect(result.holds.has('S1')).toBe(false);
    expect(result.mustRepost).toBe(true);
  });
});

describe('adoptRemoteState', () => {
  it('adopts every hold in the snapshot as authoritative, without a tie-break', () => {
    const snapshot: WireHold[] = [{ seatId: 'S1', owner: 'incumbent', expiresAt: 9_000 }];
    const result = adoptRemoteState(new Set(['S1']), 'aaa', snapshot);
    expect(result.holds.get('S1')?.owner).toBe('incumbent');
    expect(result.lostSeatIds).toEqual(['S1']);
  });

  it('ignores any snapshot entry attributed to me', () => {
    const snapshot: WireHold[] = [{ seatId: 'S1', owner: 'me', expiresAt: 9_000 }];
    const result = adoptRemoteState(new Set(), 'me', snapshot);
    expect(result.holds.size).toBe(0);
  });
});

describe('toWireHolds', () => {
  it('round-trips through adoptRemoteState', () => {
    const original = holdMap({ seatId: 'S1', owner: 'peer', expiresAt: 9_000 });
    const { holds } = adoptRemoteState(new Set(), 'me', toWireHolds(original));
    expect(holds.get('S1')).toEqual(original.get('S1'));
  });
});
