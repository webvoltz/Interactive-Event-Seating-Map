import { beforeEach, describe, expect, it } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { Row } from '../interfaces/venue.interfaces';
import { useVenueStore } from '../store/seatStore';
import Seats from './Seat';

// Two aligned rows of three seats so Arrow{Up,Down} land on a predictable
// nearest-x match, and Arrow{Left,Right} walk within a row.
const rows: Row[] = [
  {
    index: 1,
    seats: [
      { id: 'A1', col: 1, x: 0, y: 0, priceTier: 1, status: 'available' },
      { id: 'A2', col: 2, x: 10, y: 0, priceTier: 1, status: 'available' },
      { id: 'A3', col: 3, x: 20, y: 0, priceTier: 1, status: 'available' },
    ],
  },
  {
    index: 2,
    seats: [
      { id: 'B1', col: 1, x: 0, y: 10, priceTier: 1, status: 'available' },
      { id: 'B2', col: 2, x: 10, y: 10, priceTier: 1, status: 'available' },
      { id: 'B3', col: 3, x: 20, y: 10, priceTier: 1, status: 'sold' },
    ],
  },
];

const renderSeats = () => render(<svg>{<Seats rows={rows} />}</svg>);

// Small test-local helpers rather than `!` at each call site: they fail
// with a clear message if a seat/element genuinely isn't there, instead of
// silently asserting past a `null` that would otherwise surface as a
// confusing "cannot call focus on null" a few lines later.
function getSeat(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Expected element #${id} to exist in the rendered test DOM.`);
  return el;
}

function requireElement(el: Element | null): Element {
  if (!el) throw new Error('Expected an element (e.g. document.activeElement) but got null.');
  return el;
}

const resetStore = () => {
  useVenueStore.setState({
    activeSectionId: null,
    selectedSeats: new Set(),
    soldSeats: new Set(),
    zoom: 0.4,
    feedback: null,
  });
};

describe('Seats keyboard navigation and selection', () => {
  beforeEach(resetStore);

  it('moves focus right and left within a row on ArrowRight/ArrowLeft', () => {
    renderSeats();

    const seatA2 = getSeat('seat-A2');
    seatA2.focus();
    fireEvent.keyDown(seatA2, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(document.getElementById('seat-A3'));

    fireEvent.keyDown(requireElement(document.activeElement), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(document.getElementById('seat-A2'));
  });

  it('moves focus to the nearest seat in the row above/below on ArrowUp/ArrowDown', () => {
    renderSeats();

    const seatA2 = getSeat('seat-A2');
    seatA2.focus();

    fireEvent.keyDown(seatA2, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(document.getElementById('seat-B2'));

    fireEvent.keyDown(requireElement(document.activeElement), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(document.getElementById('seat-A2'));
  });

  it('toggles selection with Enter and Space', () => {
    renderSeats();
    const seatA1 = getSeat('seat-A1');
    seatA1.focus();

    fireEvent.keyDown(seatA1, { key: 'Enter' });
    expect(useVenueStore.getState().selectedSeats.has('A1')).toBe(true);
    expect(seatA1.getAttribute('aria-checked')).toBe('true');

    fireEvent.keyDown(seatA1, { key: ' ' });
    expect(useVenueStore.getState().selectedSeats.has('A1')).toBe(false);
  });

  it('toggles selection on click', () => {
    renderSeats();
    const seatA2 = getSeat('seat-A2');

    fireEvent.click(seatA2);
    expect(useVenueStore.getState().selectedSeats.has('A2')).toBe(true);
  });

  it('ignores interaction on unavailable (sold) seats', () => {
    renderSeats();
    const seatB3 = getSeat('seat-B3');

    fireEvent.click(seatB3);
    expect(useVenueStore.getState().selectedSeats.has('B3')).toBe(false);
    expect(seatB3.getAttribute('tabindex')).toBe('-1');
  });

  it('treats a seat in soldSeats as unavailable even if its data status is available', () => {
    useVenueStore.setState({ soldSeats: new Set(['A2']) });
    renderSeats();
    const seatA2 = getSeat('seat-A2');

    fireEvent.click(seatA2);
    expect(useVenueStore.getState().selectedSeats.has('A2')).toBe(false);
    expect(seatA2.getAttribute('tabindex')).toBe('-1');
    expect(seatA2.getAttribute('aria-disabled')).toBe('true');
  });
});
