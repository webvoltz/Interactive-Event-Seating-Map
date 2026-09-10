import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useVenueStore } from '../store/seatStore';
import CheckoutTimer from './CheckoutTimer';

const resetStore = () => {
  useVenueStore.setState({ selectionExpiresAt: null });
};

function getTimer(): HTMLElement {
  const el = document.querySelector('[role="timer"]');
  if (!(el instanceof HTMLElement)) throw new Error('Expected a [role="timer"] element to render.');
  return el;
}

describe('CheckoutTimer', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when there is no checkout deadline', () => {
    render(<CheckoutTimer />);
    expect(document.querySelector('[role="timer"]')).toBeNull();
  });

  it('shows the initial time remaining and ticks down after a second', () => {
    useVenueStore.setState({ selectionExpiresAt: 300_000 });
    render(<CheckoutTimer />);

    const digits = getTimer().querySelector('span[aria-hidden="true"]');
    expect(digits?.textContent).toBe('5:00');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(getTimer().querySelector('span[aria-hidden="true"]')?.textContent).toBe('4:59');
  });

  it('the ticking digits are hidden from assistive tech; the container carries the accessible name', () => {
    useVenueStore.setState({ selectionExpiresAt: 300_000 });
    render(<CheckoutTimer />);

    const timer = getTimer();
    expect(timer.getAttribute('aria-label')).toBe('Time left to complete your booking');
    const digits = timer.querySelector('span[aria-hidden="true"]');
    expect(digits).not.toBeNull();
    expect(digits?.textContent).toBe('5:00');
  });

  it('the live-region announcement is stable across ticks within one band', () => {
    useVenueStore.setState({ selectionExpiresAt: 119_000 });
    render(<CheckoutTimer />);
    const before = getTimer().querySelector('[aria-live="polite"]')?.textContent;

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    const after = getTimer().querySelector('[aria-live="polite"]')?.textContent;

    expect(after).toBe(before);
  });

  it('the live-region announcement changes on crossing the 2-minute boundary', () => {
    useVenueStore.setState({ selectionExpiresAt: 121_000 });
    render(<CheckoutTimer />);
    const before = getTimer().querySelector('[aria-live="polite"]')?.textContent;

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    const after = getTimer().querySelector('[aria-live="polite"]')?.textContent;

    expect(after).not.toBe(before);
  });

  it('applies warning styling once under a minute remains', () => {
    useVenueStore.setState({ selectionExpiresAt: 45_000 });
    render(<CheckoutTimer />);
    expect(getTimer().className).toContain('border-amber-300');
  });
});
