import { beforeEach, describe, expect, it } from 'vitest';
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
  });
  localStorage.clear();
};

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

  it('toggleSeat clears any booking currently being viewed', () => {
    useVenueStore.getState().viewBooking('BK-1');
    useVenueStore.getState().toggleSeat('SEAT-1');
    expect(useVenueStore.getState().viewingBookingId).toBeNull();
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
});
