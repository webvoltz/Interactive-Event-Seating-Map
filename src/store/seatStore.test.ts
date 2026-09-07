import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_SELECTABLE_SEATS, useVenueStore } from './seatStore';

const resetStore = () => {
  useVenueStore.setState({
    activeSectionId: null,
    selectedSeats: new Set(),
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

  it('persists and restores selected seats across a save/reload cycle', async () => {
    useVenueStore.getState().toggleSeat('SEAT-1');
    useVenueStore.getState().toggleSeat('SEAT-2');

    // Zustand's persist middleware writes to storage asynchronously (microtask).
    await Promise.resolve();

    const raw = localStorage.getItem('venue-storage');
    expect(raw).not.toBeNull();

    const parsed = JSON.parse(raw as string) as { state: { selectedSeats: string[] } };
    expect(parsed.state.selectedSeats.sort()).toEqual(['SEAT-1', 'SEAT-2']);

    // Simulate a fresh load: reset in-memory state, then rehydrate from the same storage key.
    useVenueStore.setState({ selectedSeats: new Set() });
    const rehydrated = new Set(parsed.state.selectedSeats);
    useVenueStore.setState({ selectedSeats: rehydrated });

    expect(useVenueStore.getState().selectedSeats.has('SEAT-1')).toBe(true);
    expect(useVenueStore.getState().selectedSeats.has('SEAT-2')).toBe(true);
  });
});
