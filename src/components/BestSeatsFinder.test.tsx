import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { ISeat, Section, Venue } from '../interfaces/venue.interfaces';
import { useVenueStore } from '../store/seatStore';
import BestSeatsFinder from './BestSeatsFinder';

function makeSeat(
  row: number,
  col: number,
  priceTier: number,
  status: ISeat['status'] = 'available',
): ISeat {
  return { id: `S-${row}-${col}`, col, x: col, y: row, priceTier, status };
}

const venue: Venue = {
  venueId: 'v',
  name: 'Test Venue',
  map: { width: 100, height: 100 },
  sections: [
    {
      id: 'S-1',
      label: 'Section 1',
      transform: { x: 0, y: 0, scale: 1 },
      rows: [
        { index: 1, seats: [1, 2, 3, 4, 5].map((c) => makeSeat(1, c, 1)) },
        { index: 2, seats: [1, 2, 3, 4, 5].map((c) => makeSeat(2, c, 3)) },
      ],
    } satisfies Section,
  ],
};

const resetStore = () => {
  useVenueStore.setState({
    activeSectionId: null,
    selectedSeats: new Set(),
    soldSeats: new Set(),
    viewingBookingId: null,
    feedback: null,
  });
};

function getPartySizeSelect(): HTMLSelectElement {
  const el = document.getElementById('best-seats-party-size');
  if (!(el instanceof HTMLSelectElement)) {
    throw new Error('Expected #best-seats-party-size to be a <select>.');
  }
  return el;
}

function getRadio(value: string): HTMLInputElement {
  const el = document.querySelector(`input[name="best-seats-priority"][value="${value}"]`);
  if (!(el instanceof HTMLInputElement)) {
    throw new Error(`Expected a priority radio with value "${value}".`);
  }
  return el;
}

describe('BestSeatsFinder', () => {
  beforeEach(resetStore);

  it('renders a labelled party-size select and a view/price radio group, with view checked by default', () => {
    render(<BestSeatsFinder venue={venue} />);
    expect(getPartySizeSelect().value).toBe('2');
    expect(getRadio('view').checked).toBe(true);
    expect(getRadio('price').checked).toBe(false);
  });

  it('clicking the price radio checks it and unchecks view', () => {
    render(<BestSeatsFinder venue={venue} />);
    fireEvent.click(getRadio('price'));
    expect(getRadio('price').checked).toBe(true);
    expect(getRadio('view').checked).toBe(false);
  });

  it('submitting a satisfiable party size selects exactly the found block and focuses its section', () => {
    render(<BestSeatsFinder venue={venue} />);
    fireEvent.change(getPartySizeSelect(), { target: { value: '3' } });
    fireEvent.click(document.querySelector('button[type="submit"]') ?? document.body);

    const { selectedSeats, activeSectionId } = useVenueStore.getState();
    expect(selectedSeats.size).toBe(3);
    expect(activeSectionId).toBe('S-1');
  });

  it('"Best price" finds a cheaper block than "Best view" on the same venue', () => {
    const { unmount } = render(<BestSeatsFinder venue={venue} />);
    fireEvent.click(document.querySelector('button[type="submit"]') ?? document.body);
    const viewSelection = new Set(useVenueStore.getState().selectedSeats);
    unmount();

    resetStore();
    render(<BestSeatsFinder venue={venue} />);
    fireEvent.click(getRadio('price'));
    fireEvent.click(document.querySelector('button[type="submit"]') ?? document.body);
    const priceSelection = new Set(useVenueStore.getState().selectedSeats);

    expect(priceSelection).not.toEqual(viewSelection);
  });

  it('submitting when nothing fits sets an error and leaves the selection empty', () => {
    render(<BestSeatsFinder venue={venue} />);
    fireEvent.change(getPartySizeSelect(), { target: { value: '8' } });
    fireEvent.click(document.querySelector('button[type="submit"]') ?? document.body);

    expect(useVenueStore.getState().selectedSeats.size).toBe(0);
    expect(useVenueStore.getState().feedback?.type).toBe('error');
  });

  it('excludes seats already sold in this browser', () => {
    useVenueStore.setState({
      soldSeats: new Set([1, 2, 3, 4, 5].map((c) => `S-1-${c}`)),
    });
    render(<BestSeatsFinder venue={venue} />);
    fireEvent.change(getPartySizeSelect(), { target: { value: '3' } });
    fireEvent.click(document.querySelector('button[type="submit"]') ?? document.body);

    const seatIds = Array.from(useVenueStore.getState().selectedSeats);
    expect(seatIds.length).toBe(3);
    expect(seatIds.every((id) => id.startsWith('S-2-'))).toBe(true);
  });

  it('with an existing selection, submitting asks for confirmation before replacing it', () => {
    useVenueStore.setState({ selectedSeats: new Set(['SEAT-existing']) });
    render(<BestSeatsFinder venue={venue} />);
    fireEvent.click(document.querySelector('button[type="submit"]') ?? document.body);

    expect(useVenueStore.getState().selectedSeats.has('SEAT-existing')).toBe(true);
    expect(document.body.textContent).toContain('Replace your current selection?');
  });

  it('cancelling the replace confirmation leaves the original selection untouched', () => {
    useVenueStore.setState({ selectedSeats: new Set(['SEAT-existing']) });
    render(<BestSeatsFinder venue={venue} />);
    fireEvent.click(document.querySelector('button[type="submit"]') ?? document.body);

    const cancelButton = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Cancel',
    );
    if (!cancelButton) throw new Error('Expected a Cancel button in the confirm dialog.');
    fireEvent.click(cancelButton);

    expect(Array.from(useVenueStore.getState().selectedSeats)).toEqual(['SEAT-existing']);
  });

  it('confirming the replace applies the newly found block', () => {
    useVenueStore.setState({ selectedSeats: new Set(['SEAT-existing']) });
    render(<BestSeatsFinder venue={venue} />);
    fireEvent.click(document.querySelector('button[type="submit"]') ?? document.body);

    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Replace',
    );
    if (!confirmButton) throw new Error('Expected a Replace button in the confirm dialog.');
    fireEvent.click(confirmButton);

    const { selectedSeats } = useVenueStore.getState();
    expect(selectedSeats.has('SEAT-existing')).toBe(false);
    expect(selectedSeats.size).toBe(2);
  });
});
