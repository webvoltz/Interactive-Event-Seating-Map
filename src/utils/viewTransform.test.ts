import { describe, expect, it } from 'vitest';
import type { VenueContentBounds } from './venueBounds';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampPan,
  computeFitView,
  computeFitZoom,
  computeZoomAtPoint,
  normalizeWheelDelta,
} from './viewTransform';

const bounds: VenueContentBounds = { minX: 0, minY: 0, width: 1000, height: 800 };

describe('computeFitZoom', () => {
  it('picks the smaller of the width/height ratios so content never overflows either axis', () => {
    const zoom = computeFitZoom(bounds, 500, 4000);
    expect(zoom).toBeLessThanOrEqual(0.5);
    expect(zoom).toBeGreaterThan(0.4);
  });

  it('never returns below MIN_ZOOM even for a tiny viewport', () => {
    expect(computeFitZoom(bounds, 1, 1)).toBe(MIN_ZOOM);
  });

  it('caps at 4x even when the viewport dwarfs the content', () => {
    expect(computeFitZoom(bounds, 100_000, 100_000)).toBeLessThanOrEqual(4);
  });
});

describe('computeFitView', () => {
  it('centers the fitted content in the viewport', () => {
    const { zoom, pan } = computeFitView(bounds, 2000, 2000);
    const contentW = bounds.width * zoom;
    const contentH = bounds.height * zoom;
    expect(pan.x).toBeCloseTo((2000 - contentW) / 2);
    expect(pan.y).toBeCloseTo((2000 - contentH) / 2);
  });
});

describe('clampPan', () => {
  it('leaves an in-range pan untouched', () => {
    const pan = { x: 50, y: 50 };
    expect(clampPan(pan, 1, bounds, 1200, 1000)).toEqual(pan);
  });

  it('stops content from being dragged entirely off the right/bottom edge', () => {
    const pan = clampPan({ x: -100_000, y: -100_000 }, 1, bounds, 1200, 1000);
    expect(pan.x).toBeGreaterThan(-bounds.width);
    expect(pan.y).toBeGreaterThan(-bounds.height);
  });

  it('stops content from being dragged entirely off the left/top edge', () => {
    const pan = clampPan({ x: 100_000, y: 100_000 }, 1, bounds, 1200, 1000);
    expect(pan.x).toBeLessThan(1200);
    expect(pan.y).toBeLessThan(1000);
  });

  it('falls back to centering when content is too small for the margin on both sides', () => {
    const tinyBounds: VenueContentBounds = { minX: 0, minY: 0, width: 20, height: 20 };
    const pan = clampPan({ x: 999, y: 999 }, 1, tinyBounds, 100, 100);
    expect(pan.x).toBeCloseTo((100 - 20) / 2);
    expect(pan.y).toBeCloseTo((100 - 20) / 2);
  });
});

describe('computeZoomAtPoint', () => {
  it('keeps the content point under the pointer stationary after zooming in', () => {
    const current = { zoom: 1, pan: { x: 0, y: 0 } };
    const pointerX = 300;
    const pointerY = 200;
    const next = computeZoomAtPoint(current, 2, pointerX, pointerY, bounds, 1200, 1000);

    expect(next.zoom).toBe(2);
    const screenX = next.pan.x + 300 * next.zoom;
    const screenY = next.pan.y + 200 * next.zoom;
    expect(screenX).toBeCloseTo(pointerX);
    expect(screenY).toBeCloseTo(pointerY);
  });

  it('keeps the anchor stationary when zooming out too', () => {
    const current = { zoom: 2, pan: { x: -100, y: -50 } };
    const pointerX = 400;
    const pointerY = 300;
    const worldXBefore = (pointerX - current.pan.x) / current.zoom;
    const worldYBefore = (pointerY - current.pan.y) / current.zoom;

    const next = computeZoomAtPoint(current, 1, pointerX, pointerY, bounds, 1200, 1000);

    const screenX = next.pan.x + worldXBefore * next.zoom;
    const screenY = next.pan.y + worldYBefore * next.zoom;
    expect(screenX).toBeCloseTo(pointerX);
    expect(screenY).toBeCloseTo(pointerY);
  });

  it('clamps the requested zoom to [MIN_ZOOM, MAX_ZOOM]', () => {
    const current = { zoom: 1, pan: { x: 0, y: 0 } };
    expect(computeZoomAtPoint(current, 999, 0, 0, bounds, 1200, 1000).zoom).toBe(MAX_ZOOM);
    expect(computeZoomAtPoint(current, 0.0001, 0, 0, bounds, 1200, 1000).zoom).toBe(MIN_ZOOM);
  });

  it('is a no-op when the clamped zoom equals the current zoom', () => {
    const current = { zoom: MAX_ZOOM, pan: { x: 5, y: 5 } };
    expect(computeZoomAtPoint(current, 999, 123, 456, bounds, 1200, 1000)).toBe(current);
  });
});

describe('normalizeWheelDelta', () => {
  it('passes pixel-mode deltas through unchanged', () => {
    expect(normalizeWheelDelta(10, -20, 0)).toEqual({ x: 10, y: -20 });
  });

  it('scales line-mode deltas up to pixel-ish units', () => {
    const { x, y } = normalizeWheelDelta(1, -2, 1);
    expect(x).toBeGreaterThan(1);
    expect(y).toBeLessThan(-2);
  });
});
