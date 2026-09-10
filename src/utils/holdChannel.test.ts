import { describe, expect, it, vi } from 'vitest';
import type { HoldMessage } from '../interfaces/venue.interfaces';
import { createFakeBus } from '../test/fakeBroadcastChannel';
import { createHoldChannel } from './holdChannel';

function helloMessage(from: string) {
  return { type: 'hello' as const, from, sentAt: 0, ownedSeatIds: [] };
}

describe('createHoldChannel', () => {
  it('delivers a message from A to B but not back to A', () => {
    const { factory } = createFakeBus();
    const onA = vi.fn();
    const onB = vi.fn();
    const a = createHoldChannel('a', onA, factory);
    createHoldChannel('b', onB, factory);

    a.post(helloMessage('a'));

    expect(onB).toHaveBeenCalledTimes(1);
    expect(onA).not.toHaveBeenCalled();
  });

  it('drops a message whose `from` matches this channel’s own session id', () => {
    const { factory } = createFakeBus();
    const onB = vi.fn();
    createHoldChannel('a', vi.fn(), factory);
    const b = createHoldChannel('b', onB, factory);
    // Simulate a fake bus that (unlike real BroadcastChannel) echoes back to
    // the poster - the self-check must still hold.
    b.post(helloMessage('b'));
    expect(onB).not.toHaveBeenCalled();
  });

  it('returns a no-op, unavailable channel when the factory returns null', () => {
    const onMessage = vi.fn();
    const channel = createHoldChannel('a', onMessage, () => null);

    expect(channel.available).toBe(false);
    expect(() => {
      channel.post(helloMessage('a'));
    }).not.toThrow();
    expect(() => {
      channel.close();
    }).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('returns a no-op channel when the factory throws (e.g. a restrictive privacy mode)', () => {
    const channel = createHoldChannel('a', vi.fn(), () => {
      throw new Error('BroadcastChannel is not allowed here');
    });
    expect(channel.available).toBe(false);
  });

  it('drops malformed payloads without invoking onMessage', () => {
    const { factory } = createFakeBus();
    const onB = vi.fn();
    const a = createHoldChannel('a', vi.fn(), factory);
    createHoldChannel('b', onB, factory);

    // Deliberately malformed - asserting it as a HoldMessage is exactly the
    // shape isHoldMessage exists to reject at runtime.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    a.post({ type: 'bogus' } as unknown as HoldMessage);

    expect(onB).not.toHaveBeenCalled();
  });
});
