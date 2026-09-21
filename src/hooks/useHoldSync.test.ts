import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { HoldMessage, Venue } from '../interfaces/venue.interfaces';
import { useVenueStore } from '../store/seatStore';
import { SYNC_TIMEOUT_MS } from '../utils/holdProtocol';
import { createFakeBus } from '../test/fakeBroadcastChannel';
import { createHoldChannel } from '../utils/holdChannel';
import { getSessionId } from '../utils/sessionId';
import { useHoldSync } from './useHoldSync';

const venue: Venue = {
  venueId: 'v',
  name: 'Venue',
  map: { width: 100, height: 100 },
  sections: [
    {
      id: 'S-1',
      label: 'Section 1',
      transform: { x: 0, y: 0, scale: 1 },
      rows: [
        {
          index: 1,
          seats: [
            { id: 'H1', col: 1, x: 0, y: 0, priceTier: 1, status: 'held' },
            { id: 'A1', col: 2, x: 1, y: 0, priceTier: 1, status: 'available' },
          ],
        },
      ],
    },
  ],
};

const resetStore = () => {
  useVenueStore.setState({
    selectedSeats: new Set(),
    soldSeats: new Set(),
    holds: new Map(),
    selectionExpiresAt: null,
    simulationSeeded: false,
    feedback: null,
  });
};

describe('useHoldSync', () => {
  let mySessionId: string;

  beforeEach(() => {
    resetStore();
    mySessionId = getSessionId();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts a hello message on mount', () => {
    const { factory } = createFakeBus();
    const received: HoldMessage[] = [];
    createHoldChannel('peer', (msg) => received.push(msg), factory);

    renderHook(() => {
      useHoldSync(venue, factory);
    });

    expect(received.some((m) => m.type === 'hello')).toBe(true);
  });

  it('adopts an incumbent’s state reply and does not seed its own simulation on top', () => {
    const { factory } = createFakeBus();
    const peer = createHoldChannel(
      'peer',
      (msg) => {
        if (msg.type === 'hello') {
          peer.post({
            type: 'state',
            from: 'peer',
            sentAt: Date.now(),
            to: msg.from,
            holds: [{ seatId: 'A1', owner: 'peer', expiresAt: 999_000 }],
          });
        }
      },
      factory,
    );

    renderHook(() => {
      useHoldSync(venue, factory);
    });

    expect(useVenueStore.getState().holds.get('A1')?.owner).toBe('peer');
    expect(useVenueStore.getState().simulationSeeded).toBe(true);
    expect(useVenueStore.getState().holds.has('H1')).toBe(false);
  });

  it('seeds its own simulation when no incumbent replies within the sync timeout', () => {
    const { factory } = createFakeBus();
    renderHook(() => {
      useHoldSync(venue, factory);
    });

    expect(useVenueStore.getState().simulationSeeded).toBe(false);
    vi.advanceTimersByTime(SYNC_TIMEOUT_MS);
    expect(useVenueStore.getState().simulationSeeded).toBe(true);
    expect(useVenueStore.getState().holds.has('H1')).toBe(true);
  });

  it('seeds immediately, with no wait, when the channel is unavailable', () => {
    renderHook(() => {
      useHoldSync(venue, () => null);
    });
    expect(useVenueStore.getState().simulationSeeded).toBe(true);
    expect(useVenueStore.getState().holds.has('H1')).toBe(true);
  });

  it('broadcasts a hold message when the local selection changes', () => {
    const { factory } = createFakeBus();
    const received: HoldMessage[] = [];
    createHoldChannel('peer', (msg) => received.push(msg), factory);
    renderHook(() => {
      useHoldSync(venue, factory);
    });

    useVenueStore.getState().toggleSeat('A1');

    const holdMessages = received.filter((m) => m.type === 'hold');
    expect(holdMessages.length).toBeGreaterThan(0);
    expect(holdMessages.at(-1)?.seatIds).toEqual(['A1']);
  });

  it('confirmPurchase broadcasts sold, then an empty hold', () => {
    const { factory } = createFakeBus();
    const received: HoldMessage[] = [];
    createHoldChannel('peer', (msg) => received.push(msg), factory);
    renderHook(() => {
      useHoldSync(venue, factory);
    });

    useVenueStore.getState().toggleSeat('A1');
    useVenueStore.getState().confirmPurchase(100);

    expect(received.some((m) => m.type === 'sold')).toBe(true);
    const holdMessages = received.filter((m) => m.type === 'hold');
    expect(holdMessages.at(-1)?.seatIds).toEqual([]);
  });

  it('posts goodbye on pagehide', () => {
    const { factory } = createFakeBus();
    const received: HoldMessage[] = [];
    createHoldChannel('peer', (msg) => received.push(msg), factory);
    renderHook(() => {
      useHoldSync(venue, factory);
    });

    window.dispatchEvent(new Event('pagehide'));

    expect(received.some((m) => m.type === 'goodbye')).toBe(true);
  });

  it('ingesting a remote sold message does not re-broadcast it (no ping-pong)', () => {
    const { factory } = createFakeBus();
    const peer = createHoldChannel('peer', () => undefined, factory);
    const received: HoldMessage[] = [];
    createHoldChannel('observer', (msg) => received.push(msg), factory);

    renderHook(() => {
      useHoldSync(venue, factory);
    });

    peer.post({ type: 'sold', from: 'peer', sentAt: Date.now(), seatIds: ['A1'] });

    expect(received.some((m) => m.type === 'sold' && m.from === mySessionId)).toBe(false);
    expect(useVenueStore.getState().soldSeats.has('A1')).toBe(true);
  });
});
