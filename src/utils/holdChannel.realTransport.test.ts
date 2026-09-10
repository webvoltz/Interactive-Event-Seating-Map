// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import type { HoldMessage } from '../interfaces/venue.interfaces';
import { createHoldChannel } from './holdChannel';
import { resolveSeatStatus } from './seatStatus';

describe('cross-tab hold delivery over the real BroadcastChannel', () => {
  const openChannels: { close: () => void }[] = [];

  afterEach(() => {
    openChannels.splice(0).forEach((c) => {
      c.close();
    });
  });

  it('is actually available in this environment (sanity check for the rest of the file)', () => {
    const tab = createHoldChannel('sanity', () => undefined);
    openChannels.push(tab);
    expect(tab.available).toBe(true);
  });

  it('a hold posted by one tab is received by another, live, over the real transport', async () => {
    const receivedByB: HoldMessage[] = [];
    const tabB = createHoldChannel('tab-b', (msg) => {
      receivedByB.push(msg);
    });
    const tabA = createHoldChannel('tab-a', () => undefined);
    openChannels.push(tabA, tabB);

    const expiresAt = Date.now() + 5 * 60_000;
    tabA.post({
      type: 'hold',
      from: 'tab-a',
      sentAt: Date.now(),
      seatIds: ['SEAT-1'],
      expiresAt,
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(receivedByB).toHaveLength(1);
    const message = receivedByB[0];
    if (message?.type !== 'hold') throw new Error('Expected exactly one hold message.');
    expect(message.from).toBe('tab-a');
    expect(message.seatIds).toEqual(['SEAT-1']);
    expect(message.expiresAt).toBe(expiresAt);

    const holds = new Map([['SEAT-1', { seatId: 'SEAT-1', owner: 'tab-a', expiresAt }]]);
    const status = resolveSeatStatus(
      { id: 'SEAT-1', status: 'available' },
      {
        soldSeats: new Set(),
        holds,
        selectedSeats: new Set(),
        now: Date.now(),
        simulationSeeded: true,
      },
    );
    expect(status).toBe('held');
  });

  it('a tab never receives its own broadcast back', async () => {
    const receivedByA: HoldMessage[] = [];
    const tabA = createHoldChannel('tab-a', (msg) => {
      receivedByA.push(msg);
    });
    openChannels.push(tabA);

    tabA.post({
      type: 'hold',
      from: 'tab-a',
      sentAt: Date.now(),
      seatIds: ['SEAT-1'],
      expiresAt: 0,
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(receivedByA).toHaveLength(0);
  });

  it('once released (an empty hold list), the seat is selectable again for the other tab', async () => {
    const receivedByB: HoldMessage[] = [];
    const tabB = createHoldChannel('tab-b', (msg) => {
      receivedByB.push(msg);
    });
    const tabA = createHoldChannel('tab-a', () => undefined);
    openChannels.push(tabA, tabB);

    tabA.post({ type: 'hold', from: 'tab-a', sentAt: Date.now(), seatIds: [], expiresAt: 0 });

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(receivedByB).toHaveLength(1);
    const message = receivedByB[0];
    if (message?.type !== 'hold') throw new Error('Expected exactly one hold message.');
    expect(message.seatIds).toEqual([]);

    const status = resolveSeatStatus(
      { id: 'SEAT-1', status: 'available' },
      {
        soldSeats: new Set(),
        holds: new Map(),
        selectedSeats: new Set(),
        now: Date.now(),
        simulationSeeded: true,
      },
    );
    expect(status).toBe('available');
  });
});
