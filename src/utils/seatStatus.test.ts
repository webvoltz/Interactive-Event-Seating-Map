import { describe, expect, it } from 'vitest';
import type { HoldMap, SeatHold } from '../interfaces/venue.interfaces';
import {
  SEAT_STATUS_STYLE,
  describeSeatStatus,
  isSeatSelectable,
  resolveSeatStatus,
} from './seatStatus';

function holdMap(...holds: SeatHold[]): HoldMap {
  return new Map(holds.map((h) => [h.seatId, h]));
}

const base = {
  soldSeats: new Set<string>(),
  holds: holdMap(),
  selectedSeats: new Set<string>(),
  now: 1_000,
  simulationSeeded: false,
};

describe('resolveSeatStatus', () => {
  it('a seat marked sold in venue.json resolves to sold', () => {
    expect(resolveSeatStatus({ id: 'S1', status: 'sold' }, base)).toBe('sold');
  });

  it('a seat bought locally (soldSeats) resolves to sold even if data says available', () => {
    const overlays = { ...base, soldSeats: new Set(['S1']) };
    expect(resolveSeatStatus({ id: 'S1', status: 'available' }, overlays)).toBe('sold');
  });

  it('sold beats an active foreign hold', () => {
    const overlays = {
      ...base,
      soldSeats: new Set(['S1']),
      holds: holdMap({ seatId: 'S1', owner: 'peer', expiresAt: 5_000 }),
    };
    expect(resolveSeatStatus({ id: 'S1', status: 'available' }, overlays)).toBe('sold');
  });

  it('sold beats being in this tab’s own selection', () => {
    const overlays = { ...base, soldSeats: new Set(['S1']), selectedSeats: new Set(['S1']) };
    expect(resolveSeatStatus({ id: 'S1', status: 'available' }, overlays)).toBe('sold');
  });

  it('an active hold (expiresAt in the future) resolves to held', () => {
    const overlays = { ...base, holds: holdMap({ seatId: 'S1', owner: 'peer', expiresAt: 5_000 }) };
    expect(resolveSeatStatus({ id: 'S1', status: 'available' }, overlays)).toBe('held');
  });

  it('expiresAt === now is treated as lapsed, not held', () => {
    const overlays = { ...base, holds: holdMap({ seatId: 'S1', owner: 'peer', expiresAt: 1_000 }) };
    expect(resolveSeatStatus({ id: 'S1', status: 'available' }, overlays)).toBe('available');
  });

  it('expiresAt < now is treated as lapsed', () => {
    const overlays = { ...base, holds: holdMap({ seatId: 'S1', owner: 'peer', expiresAt: 500 }) };
    expect(resolveSeatStatus({ id: 'S1', status: 'available' }, overlays)).toBe('available');
  });

  it('a lapsed hold record falls through to selected when the seat is also mine', () => {
    const overlays = {
      ...base,
      holds: holdMap({ seatId: 'S1', owner: 'peer', expiresAt: 500 }),
      selectedSeats: new Set(['S1']),
    };
    expect(resolveSeatStatus({ id: 'S1', status: 'available' }, overlays)).toBe('selected');
  });

  it('a foreign hold outranks this tab’s own selection (fail-safe ordering)', () => {
    const overlays = {
      ...base,
      holds: holdMap({ seatId: 'S1', owner: 'peer', expiresAt: 5_000 }),
      selectedSeats: new Set(['S1']),
    };
    expect(resolveSeatStatus({ id: 'S1', status: 'available' }, overlays)).toBe('held');
  });

  it('a seat in selectedSeats resolves to selected', () => {
    const overlays = { ...base, selectedSeats: new Set(['S1']) };
    expect(resolveSeatStatus({ id: 'S1', status: 'available' }, overlays)).toBe('selected');
  });

  it('reserved survives a stale/absent hold record', () => {
    expect(resolveSeatStatus({ id: 'S1', status: 'reserved' }, base)).toBe('reserved');
  });

  it('a JSON-held seat resolves to held before the simulation has seeded', () => {
    expect(
      resolveSeatStatus({ id: 'S1', status: 'held' }, { ...base, simulationSeeded: false }),
    ).toBe('held');
  });

  it('the same JSON-held seat resolves to available once seeded, with no live hold record', () => {
    expect(
      resolveSeatStatus({ id: 'S1', status: 'held' }, { ...base, simulationSeeded: true }),
    ).toBe('available');
  });

  it('a plain available seat with no overlays resolves to available', () => {
    expect(resolveSeatStatus({ id: 'S1', status: 'available' }, base)).toBe('available');
  });
});

describe('isSeatSelectable', () => {
  it.each([
    ['available', true],
    ['selected', true],
    ['sold', false],
    ['reserved', false],
    ['held', false],
  ] as const)('%s -> %s', (status, expected) => {
    expect(isSeatSelectable(status)).toBe(expected);
  });
});

describe('describeSeatStatus', () => {
  it.each([
    ['available', 'available'],
    ['selected', 'selected'],
    ['sold', 'sold'],
    ['reserved', 'reserved'],
    ['held', 'temporarily held by another customer'],
  ] as const)('%s -> %s', (status, expected) => {
    expect(describeSeatStatus(status)).toBe(expected);
  });
});

describe('SEAT_STATUS_STYLE', () => {
  it('has an entry for every effective status', () => {
    (['available', 'selected', 'sold', 'reserved', 'held'] as const).forEach((status) => {
      expect(SEAT_STATUS_STYLE[status]).toBeDefined();
    });
  });
});
