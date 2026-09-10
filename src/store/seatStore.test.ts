import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HoldMap } from '../interfaces/venue.interfaces';
import { SELECTION_HOLD_MS } from '../utils/holdProtocol';
import { MAX_SELECTABLE_SEATS, useVenueStore } from './seatStore';

// Throwing (rather than `expect(raw).not.toBeNull()` + a `!` at the call
// site) gives TypeScript a real narrowing point, and still fails the test
// with a clear message if persistence didn't happen as expected.
function getPersistedRaw(): string {
  const raw = localStorage.getItem('venue-storage');
  if (raw === null) throw new Error('Expected venue-storage to be persisted in localStorage.');
  return raw;
}

const resetStore = () => {
  useVenueStore.setState({
    activeSectionId: null,
    selectedSeats: new Set(),
    soldSeats: new Set(),
    bookings: [],
    viewingBookingId: null,
    zoom: 0.4,
    feedback: null,
    holds: new Map(),
    selectionExpiresAt: null,
    simulationSeeded: false,
  });
  localStorage.clear();
};

function holdMap(seatId: string, expiresAt: number, owner = 'peer'): HoldMap {
  return new Map([[seatId, { seatId, owner, expiresAt }]]);
}

describe('seatStore', () => {
  beforeEach(resetStore);

  it('selects a seat via toggleSeat', () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    expect(useVenueStore.getState().selectedSeats.has('SEAT-1')).toBe(true);
  });

  it('deselects an already-selected seat via toggleSeat', () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    useVenueStore.getState().toggleSeat('SEAT-1');
    expect(useVenueStore.getState().selectedSeats.has('SEAT-1')).toBe(false);
  });

  it('enforces the max-seat rule and surfaces feedback instead of throwing/alerting', () => {
    for (let i = 1; i <= MAX_SELECTABLE_SEATS; i++) {
      useVenueStore.getState().toggleSeat(`SEAT-${i}`);
    }
    expect(useVenueStore.getState().selectedSeats.size).toBe(MAX_SELECTABLE_SEATS);

    useVenueStore.getState().toggleSeat('SEAT-overflow');

    expect(useVenueStore.getState().selectedSeats.size).toBe(MAX_SELECTABLE_SEATS);
    expect(useVenueStore.getState().selectedSeats.has('SEAT-overflow')).toBe(false);
    expect(useVenueStore.getState().feedback).toEqual({
      type: 'error',
      message: `You can select a maximum of ${MAX_SELECTABLE_SEATS} seats.`,
    });
  });

  it('clears the selection via clearSelection', () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    useVenueStore.getState().toggleSeat('SEAT-2');
    useVenueStore.getState().clearSelection();
    expect(useVenueStore.getState().selectedSeats.size).toBe(0);
  });

  it('clearSelection nulls the checkout deadline', () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    useVenueStore.getState().clearSelection();
    expect(useVenueStore.getState().selectionExpiresAt).toBeNull();
  });

  describe('checkout hold timing', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('the first seat added starts the checkout deadline', () => {
      useVenueStore.getState().toggleSeat('SEAT-1');
      expect(useVenueStore.getState().selectionExpiresAt).toBe(SELECTION_HOLD_MS);
    });

    it('adding a second seat does not extend the deadline', () => {
      useVenueStore.getState().toggleSeat('SEAT-1');
      vi.advanceTimersByTime(10_000);
      useVenueStore.getState().toggleSeat('SEAT-2');
      expect(useVenueStore.getState().selectionExpiresAt).toBe(SELECTION_HOLD_MS);
    });

    it('refuses to select a seat with a live foreign hold, with feedback', () => {
      useVenueStore.setState({ holds: holdMap('SEAT-1', 5_000) });
      useVenueStore.getState().toggleSeat('SEAT-1');
      expect(useVenueStore.getState().selectedSeats.has('SEAT-1')).toBe(false);
      expect(useVenueStore.getState().feedback?.type).toBe('error');
    });

    it('allows selecting a seat whose hold has already lapsed', () => {
      useVenueStore.setState({ holds: holdMap('SEAT-1', 500) });
      vi.setSystemTime(1_000);
      useVenueStore.getState().toggleSeat('SEAT-1');
      expect(useVenueStore.getState().selectedSeats.has('SEAT-1')).toBe(true);
    });
  });

  it('confirmPurchase moves selected seats into soldSeats and empties the cart', () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    useVenueStore.getState().toggleSeat('SEAT-2');
    useVenueStore.getState().confirmPurchase(6000);

    expect(useVenueStore.getState().selectedSeats.size).toBe(0);
    expect(useVenueStore.getState().soldSeats.has('SEAT-1')).toBe(true);
    expect(useVenueStore.getState().soldSeats.has('SEAT-2')).toBe(true);
  });

  it('confirmPurchase accumulates across multiple purchases rather than overwriting', () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    useVenueStore.getState().confirmPurchase(3000);

    useVenueStore.getState().toggleSeat('SEAT-2');
    useVenueStore.getState().confirmPurchase(3000);

    expect(useVenueStore.getState().soldSeats.has('SEAT-1')).toBe(true);
    expect(useVenueStore.getState().soldSeats.has('SEAT-2')).toBe(true);
  });

  it('confirmPurchase records a Booking grouping the just-bought seats and views it', () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    useVenueStore.getState().toggleSeat('SEAT-2');
    useVenueStore.getState().confirmPurchase(6000);

    const { bookings, viewingBookingId } = useVenueStore.getState();
    expect(bookings).toHaveLength(1);
    expect(bookings[0]?.seatIds.sort()).toEqual(['SEAT-1', 'SEAT-2']);
    expect(bookings[0]?.total).toBe(6000);
    expect(viewingBookingId).toBe(bookings[0]?.id);
  });

  it('confirmPurchase prepends new bookings so the newest is first', () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    useVenueStore.getState().confirmPurchase(3000);
    useVenueStore.getState().toggleSeat('SEAT-2');
    useVenueStore.getState().confirmPurchase(3000);

    const { bookings } = useVenueStore.getState();
    expect(bookings).toHaveLength(2);
    expect(bookings[0]?.seatIds).toEqual(['SEAT-2']);
    expect(bookings[1]?.seatIds).toEqual(['SEAT-1']);
  });

  it('confirmPurchase returns the booking and nulls the checkout deadline', () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    const booking = useVenueStore.getState().confirmPurchase(7000);
    expect(booking?.seatIds).toEqual(['SEAT-1']);
    expect(useVenueStore.getState().selectionExpiresAt).toBeNull();
  });

  it('confirmPurchase refuses an already-expired hold: no booking, cart cleared, error feedback', () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    useVenueStore.setState({ selectionExpiresAt: Date.now() - 1 });

    const booking = useVenueStore.getState().confirmPurchase(7000);

    expect(booking).toBeNull();
    expect(useVenueStore.getState().selectedSeats.size).toBe(0);
    expect(useVenueStore.getState().soldSeats.has('SEAT-1')).toBe(false);
    expect(useVenueStore.getState().bookings).toHaveLength(0);
    expect(useVenueStore.getState().feedback?.type).toBe('error');
  });

  it('confirmPurchase still succeeds when selectionExpiresAt is null (e.g. state seeded directly)', () => {
    useVenueStore.setState({ selectedSeats: new Set(['SEAT-1']), selectionExpiresAt: null });
    const booking = useVenueStore.getState().confirmPurchase(7000);
    expect(booking).not.toBeNull();
    expect(useVenueStore.getState().soldSeats.has('SEAT-1')).toBe(true);
  });

  it('releaseLostSeats drops just the named seats and nulls the deadline if the cart empties', () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    useVenueStore.getState().releaseLostSeats(['SEAT-1']);
    expect(useVenueStore.getState().selectedSeats.size).toBe(0);
    expect(useVenueStore.getState().selectionExpiresAt).toBeNull();
    expect(useVenueStore.getState().feedback?.type).toBe('error');
  });

  it('applyRemoteSold marks seats sold, drops their holds, and removes them from my selection', () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    useVenueStore.setState({ holds: holdMap('SEAT-2', 9_000) });

    useVenueStore.getState().applyRemoteSold(['SEAT-1', 'SEAT-2']);

    const state = useVenueStore.getState();
    expect(state.soldSeats.has('SEAT-1')).toBe(true);
    expect(state.soldSeats.has('SEAT-2')).toBe(true);
    expect(state.holds.has('SEAT-2')).toBe(false);
    expect(state.selectedSeats.has('SEAT-1')).toBe(false);
    expect(state.selectionExpiresAt).toBeNull();
  });

  it('seedSimulation is a no-op once simulationSeeded is already true', () => {
    useVenueStore.setState({ simulationSeeded: true, holds: holdMap('SEAT-1', 9_000) });
    useVenueStore.getState().seedSimulation(holdMap('SEAT-2', 9_000));
    expect(useVenueStore.getState().holds.has('SEAT-1')).toBe(true);
    expect(useVenueStore.getState().holds.has('SEAT-2')).toBe(false);
  });

  describe('runExpiry', () => {
    it('leaves the holds map reference identical when nothing has lapsed', () => {
      const holds = holdMap('SEAT-1', 9_000);
      useVenueStore.setState({ holds });
      useVenueStore.getState().runExpiry(1_000);
      // Reference identity (`toBe`), not just equal contents - this is what
      // lets a routine tick skip re-rendering ~1,500 mounted seats.
      expect(useVenueStore.getState().holds).toBe(holds);
    });

    it('prunes a lapsed hold', () => {
      useVenueStore.setState({ holds: holdMap('SEAT-1', 500) });
      useVenueStore.getState().runExpiry(1_000);
      expect(useVenueStore.getState().holds.size).toBe(0);
    });

    it('releases an expired selection with feedback', () => {
      useVenueStore.setState({
        selectedSeats: new Set(['SEAT-1']),
        selectionExpiresAt: 500,
      });
      useVenueStore.getState().runExpiry(1_000);
      expect(useVenueStore.getState().selectedSeats.size).toBe(0);
      expect(useVenueStore.getState().selectionExpiresAt).toBeNull();
      expect(useVenueStore.getState().feedback?.type).toBe('info');
    });

    it('does nothing when the selection deadline is still in the future', () => {
      useVenueStore.setState({
        selectedSeats: new Set(['SEAT-1']),
        selectionExpiresAt: 9_000,
      });
      useVenueStore.getState().runExpiry(1_000);
      expect(useVenueStore.getState().selectedSeats.has('SEAT-1')).toBe(true);
    });
  });

  it('toggleSeat clears any booking currently being viewed', () => {
    useVenueStore.getState().viewBooking('BK-1');
    useVenueStore.getState().toggleSeat('SEAT-1');
    expect(useVenueStore.getState().viewingBookingId).toBeNull();
  });

  it('selectSeatBlock replaces the current selection rather than merging into it', () => {
    useVenueStore.getState().toggleSeat('SEAT-unrelated');
    useVenueStore.getState().selectSeatBlock(['SEAT-1', 'SEAT-2', 'SEAT-3'], 'S-1');

    const { selectedSeats } = useVenueStore.getState();
    expect(Array.from(selectedSeats).sort()).toEqual(['SEAT-1', 'SEAT-2', 'SEAT-3']);
  });

  it('selectSeatBlock sets activeSectionId in the same update', () => {
    useVenueStore.getState().selectSeatBlock(['SEAT-1'], 'S-4');
    expect(useVenueStore.getState().activeSectionId).toBe('S-4');
  });

  it('selectSeatBlock clears any booking currently being viewed', () => {
    useVenueStore.getState().viewBooking('BK-1');
    useVenueStore.getState().selectSeatBlock(['SEAT-1'], 'S-1');
    expect(useVenueStore.getState().viewingBookingId).toBeNull();
  });

  it('selectSeatBlock refuses more than MAX_SELECTABLE_SEATS ids and leaves the selection untouched', () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    const tooMany = Array.from({ length: MAX_SELECTABLE_SEATS + 1 }, (_, i) => `SEAT-block-${i}`);

    useVenueStore.getState().selectSeatBlock(tooMany, 'S-1');

    expect(Array.from(useVenueStore.getState().selectedSeats)).toEqual(['SEAT-1']);
    expect(useVenueStore.getState().feedback).toEqual({
      type: 'error',
      message: `You can select a maximum of ${MAX_SELECTABLE_SEATS} seats.`,
    });
  });

  it('selectSeatBlock with an empty array leaves the selection untouched', () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    useVenueStore.getState().selectSeatBlock([], 'S-1');
    expect(Array.from(useVenueStore.getState().selectedSeats)).toEqual(['SEAT-1']);
  });

  it('a seat chosen via selectSeatBlock can still be individually deselected via toggleSeat', () => {
    useVenueStore.getState().selectSeatBlock(['SEAT-1', 'SEAT-2'], 'S-1');
    useVenueStore.getState().toggleSeat('SEAT-1');
    expect(Array.from(useVenueStore.getState().selectedSeats)).toEqual(['SEAT-2']);
  });

  it('viewBooking and clearViewingBooking control which booking is highlighted', () => {
    useVenueStore.getState().viewBooking('BK-1');
    expect(useVenueStore.getState().viewingBookingId).toBe('BK-1');
    useVenueStore.getState().clearViewingBooking();
    expect(useVenueStore.getState().viewingBookingId).toBeNull();
  });

  it('persists and restores selected seats across a save/reload cycle', async () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    useVenueStore.getState().toggleSeat('SEAT-2');

    // Zustand's persist middleware writes to storage asynchronously (microtask).
    await Promise.resolve();

    const raw = getPersistedRaw();
    // Asserting the shape here (rather than writing a full type guard) is
    // fine specifically because this is the exact data this test just wrote
    // two lines above via toggleSeat() - not untrusted external input.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const parsed = JSON.parse(raw) as unknown as {
      state: { selectedSeats: string[]; soldSeats: string[] };
    };
    expect(parsed.state.selectedSeats.sort()).toEqual(['SEAT-1', 'SEAT-2']);

    // Simulate a fresh load: reset in-memory state, then rehydrate from the same storage key.
    useVenueStore.setState({ selectedSeats: new Set() });
    const rehydrated = new Set(parsed.state.selectedSeats);
    useVenueStore.setState({ selectedSeats: rehydrated });

    expect(useVenueStore.getState().selectedSeats.has('SEAT-1')).toBe(true);
    expect(useVenueStore.getState().selectedSeats.has('SEAT-2')).toBe(true);
  });

  it('persists sold seats across a save/reload cycle, surviving a fresh selection', async () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    useVenueStore.getState().confirmPurchase(7000);

    await Promise.resolve();

    const raw = getPersistedRaw();
    // Same reasoning as the previous test: asserting the shape of data this
    // test just wrote itself, not untrusted external input.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const parsed = JSON.parse(raw) as unknown as { state: { soldSeats: string[] } };
    expect(parsed.state.soldSeats).toEqual(['SEAT-1']);

    // Simulate a fresh load rehydrating from that same storage key.
    useVenueStore.setState({ soldSeats: new Set() });
    useVenueStore.setState({ soldSeats: new Set(parsed.state.soldSeats) });

    expect(useVenueStore.getState().soldSeats.has('SEAT-1')).toBe(true);
  });

  it('persists booking history across a save/reload cycle', async () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    useVenueStore.getState().confirmPurchase(7000);

    await Promise.resolve();

    const raw = getPersistedRaw();
    // Same reasoning as the previous tests: asserting the shape of data this
    // test just wrote itself, not untrusted external input.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const parsed = JSON.parse(raw) as unknown as {
      state: { bookings: { id: string; seatIds: string[]; total: number; createdAt: number }[] };
    };
    expect(parsed.state.bookings).toHaveLength(1);
    expect(parsed.state.bookings[0]?.seatIds).toEqual(['SEAT-1']);
    expect(parsed.state.bookings[0]?.total).toBe(7000);

    // Simulate a fresh load rehydrating from that same storage key.
    useVenueStore.setState({ bookings: [] });
    useVenueStore.setState({ bookings: parsed.state.bookings });

    expect(useVenueStore.getState().bookings).toHaveLength(1);
  });

  it('persists the checkout deadline across a save/reload cycle', async () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    const deadline = useVenueStore.getState().selectionExpiresAt;

    await Promise.resolve();

    const raw = getPersistedRaw();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const parsed = JSON.parse(raw) as unknown as { state: { selectionExpiresAt: number | null } };
    expect(parsed.state.selectionExpiresAt).toBe(deadline);

    useVenueStore.setState({ selectionExpiresAt: null });
    useVenueStore.setState({ selectionExpiresAt: parsed.state.selectionExpiresAt });
    expect(useVenueStore.getState().selectionExpiresAt).toBe(deadline);
  });

  it('never writes holds to localStorage - they are session-local, not persisted state', async () => {
    useVenueStore.setState({ holds: holdMap('SEAT-1', 9_000) });
    useVenueStore.getState().toggleSeat('SEAT-2');

    await Promise.resolve();

    const raw = getPersistedRaw();
    expect(raw).not.toContain('"holds"');
  });
});
