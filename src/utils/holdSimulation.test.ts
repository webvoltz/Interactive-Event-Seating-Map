import { describe, expect, it } from 'vitest';
import type { ISeat, Row, Section, Venue } from '../interfaces/venue.interfaces';
import { SIMULATED_OWNER } from '../interfaces/venue.interfaces';
import { RELEASE_TICK_MS, SIM_WINDOW_MS } from './holdProtocol';
import { hash32, seedSimulatedHolds, simulatedExpiry } from './holdSimulation';

function makeSeat(id: string, status: ISeat['status'] = 'available'): ISeat {
  return { id, col: 1, x: 0, y: 0, priceTier: 1, status };
}

function makeVenue(seats: ISeat[]): Venue {
  const row: Row = { index: 1, seats };
  const section: Section = {
    id: 'S-1',
    label: 'Section 1',
    transform: { x: 0, y: 0, scale: 1 },
    rows: [row],
  };
  return { venueId: 'v', name: 'Venue', map: { width: 100, height: 100 }, sections: [section] };
}

const ANCHOR = 1_000_000;

describe('hash32', () => {
  it('is deterministic for the same input', () => {
    expect(hash32('SEAT-42')).toBe(hash32('SEAT-42'));
  });

  it('produces different values for different inputs (smoke test)', () => {
    const values = new Set(Array.from({ length: 50 }, (_, i) => hash32(`SEAT-${i}`)));
    expect(values.size).toBeGreaterThan(40);
  });
});

describe('simulatedExpiry', () => {
  it('is always within (anchor, anchor + SIM_WINDOW_MS]', () => {
    for (let i = 0; i < 50; i++) {
      const expiry = simulatedExpiry(`SEAT-${i}`, ANCHOR);
      expect(expiry).toBeGreaterThan(ANCHOR);
      expect(expiry).toBeLessThanOrEqual(ANCHOR + SIM_WINDOW_MS);
    }
  });

  it('is quantized to the release tick grid', () => {
    for (let i = 0; i < 50; i++) {
      const expiry = simulatedExpiry(`SEAT-${i}`, ANCHOR);
      expect((expiry - ANCHOR) % RELEASE_TICK_MS).toBe(0);
    }
  });
});

describe('seedSimulatedHolds', () => {
  it('seeds only seats whose status is held, leaving other statuses untouched', () => {
    const seats = [
      makeSeat('A', 'available'),
      makeSeat('B', 'held'),
      makeSeat('C', 'sold'),
      makeSeat('D', 'reserved'),
      makeSeat('E', 'held'),
    ];
    const holds = seedSimulatedHolds(makeVenue(seats), ANCHOR, new Set());
    expect(Array.from(holds.keys()).sort()).toEqual(['B', 'E']);
  });

  it('skips a held seat that is already in the selection', () => {
    const seats = [makeSeat('A', 'held'), makeSeat('B', 'held')];
    const holds = seedSimulatedHolds(makeVenue(seats), ANCHOR, new Set(['A']));
    expect(Array.from(holds.keys())).toEqual(['B']);
  });

  it('owner is the simulated sentinel, never a real session id', () => {
    const holds = seedSimulatedHolds(makeVenue([makeSeat('A', 'held')]), ANCHOR, new Set());
    expect(holds.get('A')?.owner).toBe(SIMULATED_OWNER);
  });

  it('is deterministic and order-independent: a shuffled fixture yields the identical map', () => {
    const seats = Array.from({ length: 20 }, (_, i) => makeSeat(`H${i}`, 'held'));
    const shuffled = [...seats].reverse();

    const a = seedSimulatedHolds(makeVenue(seats), ANCHOR, new Set());
    const b = seedSimulatedHolds(makeVenue(shuffled), ANCHOR, new Set());

    expect(Object.fromEntries(a)).toEqual(Object.fromEntries(b));
  });

  it('staggers releases across multiple buckets rather than firing all at once', () => {
    const seats = Array.from({ length: 100 }, (_, i) => makeSeat(`H${i}`, 'held'));
    const holds = seedSimulatedHolds(makeVenue(seats), ANCHOR, new Set());
    const buckets = new Set(Array.from(holds.values(), (h) => h.expiresAt));
    expect(buckets.size).toBeGreaterThan(1);
  });
});
