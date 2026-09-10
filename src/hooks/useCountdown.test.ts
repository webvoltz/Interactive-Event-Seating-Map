import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCountdown } from './useCountdown';

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts down as time advances', () => {
    vi.setSystemTime(0);
    const { result } = renderHook(() => useCountdown(5000));
    expect(result.current).toBe(5000);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(4000);
  });

  it('clamps at 0 and stops scheduling once the deadline passes', () => {
    vi.setSystemTime(0);
    const { result } = renderHook(() => useCountdown(1000));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns null and schedules nothing when there is no deadline', () => {
    const { result } = renderHook(() => useCountdown(null));
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer on unmount', () => {
    vi.setSystemTime(0);
    const { unmount } = renderHook(() => useCountdown(5000));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reschedules when the deadline changes', () => {
    vi.setSystemTime(0);
    const { result, rerender } = renderHook(
      ({ deadline }: { deadline: number | null }) => useCountdown(deadline),
      { initialProps: { deadline: 5000 } },
    );
    expect(result.current).toBe(5000);
    rerender({ deadline: 10000 });
    expect(result.current).toBe(10000);
  });
});
