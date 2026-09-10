import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import SeatStatusLegend from './SeatStatusLegend';

describe('SeatStatusLegend', () => {
  it('renders all four statuses', () => {
    render(<SeatStatusLegend />);
    const region = document.querySelector('[role="region"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toContain('Selected');
    expect(region?.textContent).toContain('Sold');
    expect(region?.textContent).toContain('Reserved');
    expect(region?.textContent).toContain('Held');
  });
});
