import type { VenueContentBounds } from './venueBounds';

export interface Pan {
  x: number;
  y: number;
}

export interface ViewState {
  zoom: number;
  pan: Pan;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 0.2;

export const DEFAULT_TRANSITION_MS = 200;
export const SECTION_FOCUS_TRANSITION_MS = 650;

const FIT_SAFETY_MARGIN = 0.96;
const PAN_VISIBLE_MARGIN = 80;

export function computeFitZoom(
  bounds: VenueContentBounds,
  availableWidth: number,
  availableHeight: number,
): number {
  const fitScale = Math.min(availableWidth / bounds.width, availableHeight / bounds.height, 4);
  return Math.max(fitScale * FIT_SAFETY_MARGIN, MIN_ZOOM);
}

export function computeFitView(
  bounds: VenueContentBounds,
  containerWidth: number,
  containerHeight: number,
): ViewState {
  const zoom = computeFitZoom(bounds, containerWidth - 64, containerHeight - 64);
  return {
    zoom,
    pan: {
      x: (containerWidth - bounds.width * zoom) / 2,
      y: (containerHeight - bounds.height * zoom) / 2,
    },
  };
}

function clampPanAxis(value: number, containerSize: number, contentSize: number): number {
  const min = PAN_VISIBLE_MARGIN - contentSize;
  const max = containerSize - PAN_VISIBLE_MARGIN;
  if (min <= max) return Math.min(Math.max(value, min), max);
  return (containerSize - contentSize) / 2;
}

export function clampPan(
  pan: Pan,
  zoom: number,
  bounds: VenueContentBounds,
  containerWidth: number,
  containerHeight: number,
): Pan {
  return {
    x: clampPanAxis(pan.x, containerWidth, bounds.width * zoom),
    y: clampPanAxis(pan.y, containerHeight, bounds.height * zoom),
  };
}

export function computeZoomAtPoint(
  current: ViewState,
  newZoomRaw: number,
  pointerX: number,
  pointerY: number,
  bounds: VenueContentBounds,
  containerWidth: number,
  containerHeight: number,
): ViewState {
  const newZoom = Math.min(Math.max(newZoomRaw, MIN_ZOOM), MAX_ZOOM);
  if (newZoom === current.zoom) return current;

  const worldX = (pointerX - current.pan.x) / current.zoom;
  const worldY = (pointerY - current.pan.y) / current.zoom;

  const pan = clampPan(
    { x: pointerX - worldX * newZoom, y: pointerY - worldY * newZoom },
    newZoom,
    bounds,
    containerWidth,
    containerHeight,
  );
  return { zoom: newZoom, pan };
}

export function normalizeWheelDelta(deltaX: number, deltaY: number, deltaMode: number): Pan {
  const LINE_HEIGHT_PX = 16;
  if (deltaMode === 1) {
    return { x: deltaX * LINE_HEIGHT_PX, y: deltaY * LINE_HEIGHT_PX };
  }
  if (deltaMode === 2) {
    return { x: deltaX * window.innerWidth, y: deltaY * window.innerHeight };
  }
  return { x: deltaX, y: deltaY };
}
