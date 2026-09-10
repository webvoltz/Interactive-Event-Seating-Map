import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Venue } from '../interfaces/venue.interfaces';
import { useVenueStore } from '../store/seatStore';
import { TIERS } from '../utils/seatIndex';
import SelectionToolbar from './SelectionToolbar';

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
            { id: 'SEAT-1', col: 1, x: 0, y: 0, priceTier: 1, status: 'available' },
            { id: 'SEAT-2', col: 2, x: 10, y: 0, priceTier: 2, status: 'available' },
          ],
        },
      ],
    },
  ],
};

const resetStore = () => {
  useVenueStore.setState({ selectedSeats: new Set(), selectionExpiresAt: null });
};

function getToolbar(): HTMLElement | null {
  return document.querySelector('[role="toolbar"]');
}

describe('SelectionToolbar', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when no seats are selected', () => {
    render(<SelectionToolbar venue={venue} />);
    expect(getToolbar()).toBeNull();
  });

  it('shows the selected count and running total', () => {
    useVenueStore.setState({ selectedSeats: new Set(['SEAT-1', 'SEAT-2']) });
    render(<SelectionToolbar venue={venue} />);

    const toolbar = getToolbar();
    expect(toolbar).not.toBeNull();
    expect(toolbar?.textContent).toContain('2 seats selected');
    const tier1 = TIERS[1]?.price ?? 0;
    const tier2 = TIERS[2]?.price ?? 0;
    expect(toolbar?.textContent).toContain(`$${tier1 + tier2}`);
  });

  it('uses singular copy for exactly one seat', () => {
    useVenueStore.setState({ selectedSeats: new Set(['SEAT-1']) });
    render(<SelectionToolbar venue={venue} />);
    expect(getToolbar()?.textContent).toContain('1 seat selected');
  });

  it('shows no countdown when there is no checkout deadline', () => {
    useVenueStore.setState({ selectedSeats: new Set(['SEAT-1']), selectionExpiresAt: null });
    render(<SelectionToolbar venue={venue} />);
    expect(getToolbar()?.querySelectorAll('svg')).toHaveLength(1);
  });

  it('shows a live countdown when a checkout deadline is set', () => {
    useVenueStore.setState({
      selectedSeats: new Set(['SEAT-1']),
      selectionExpiresAt: 300_000,
    });
    render(<SelectionToolbar venue={venue} />);
    expect(getToolbar()?.textContent).toContain('5:00');
  });

  it('the Remove button clears the selection', () => {
    useVenueStore.setState({ selectedSeats: new Set(['SEAT-1', 'SEAT-2']) });
    render(<SelectionToolbar venue={venue} />);

    const removeButton = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Remove'),
    );
    if (!removeButton) throw new Error('Expected a "Remove" button to render.');
    fireEvent.click(removeButton);

    expect(useVenueStore.getState().selectedSeats.size).toBe(0);
  });
});
