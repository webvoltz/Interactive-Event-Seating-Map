import VenueMap from './components/VenueMap';
import { useVenue } from './hooks/useVenue';
import BookingSummary from './components/BookingSummary';
import Toast from './components/Toast';
import Icon from './components/Icon';
import IconButton from './components/IconButton';
import { useCallback, useEffect, useState, useRef } from 'react';
import { useVenueStore } from './store/seatStore';
import { getVenueContentBounds, type VenueContentBounds } from './utils/venueBounds';
import {
  ZOOM_STEP,
  computeFitView,
  clampPan,
  computeZoomAtPoint,
  normalizeWheelDelta,
} from './utils/viewTransform';

function getContainerSize(container: HTMLDivElement | null): { width: number; height: number } {
  if (container) return { width: container.clientWidth, height: container.clientHeight };
  return {
    width: window.innerWidth - (window.innerWidth >= 768 ? 400 : 0),
    height: window.innerHeight,
  };
}

function zoomAtPoint(
  container: HTMLDivElement | null,
  bounds: VenueContentBounds,
  newZoomRaw: number,
  clientX: number,
  clientY: number,
) {
  const { zoom, pan, setView } = useVenueStore.getState();
  const rect = container?.getBoundingClientRect();
  const { width, height } = getContainerSize(container);
  const next = computeZoomAtPoint(
    { zoom, pan },
    newZoomRaw,
    clientX - (rect?.left ?? 0),
    clientY - (rect?.top ?? 0),
    bounds,
    width,
    height,
  );
  setView(next.zoom, next.pan);
}

const App = () => {
  const { venue, error, loading, refetch } = useVenue();
  const zoom = useVenueStore((s) => s.zoom);
  const pan = useVenueStore((s) => s.pan);
  const setPan = useVenueStore((s) => s.setPan);
  const setView = useVenueStore((s) => s.setView);
  const selectedSeatsCount = useVenueStore((s) => s.selectedSeats.size);
  const [showSidebar, setShowSidebar] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const [isInteracting, setIsInteracting] = useState(false);
  const interactionTimeoutRef = useRef<number | undefined>(undefined);
  const markInteracting = useCallback(() => {
    setIsInteracting(true);
    window.clearTimeout(interactionTimeoutRef.current);
    interactionTimeoutRef.current = window.setTimeout(() => {
      setIsInteracting(false);
    }, 200);
  }, []);
  useEffect(() => {
    return () => {
      window.clearTimeout(interactionTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (venue) {
      // Check if we have selected seats from persistence
      const selectedSeats = useVenueStore.getState().selectedSeats;
      if (selectedSeats.size > 0) {
        // Find the section containing the first selected seat
        const firstSeatId = Array.from(selectedSeats)[0];
        let sectionToOpen = null;

        for (const section of venue.sections) {
          for (const row of section.rows) {
            if (row.seats.some((s) => s.id === firstSeatId)) {
              sectionToOpen = section.id;
              break;
            }
          }
          if (sectionToOpen) break;
        }

        if (sectionToOpen) {
          useVenueStore.getState().setActiveSection(sectionToOpen);
          return; // Skip default zoom
        }
      }

      const { width, height } = getContainerSize(mapContainerRef.current);
      const { zoom: fitZoom, pan: fitPan } = computeFitView(
        getVenueContentBounds(venue),
        width,
        height,
      );
      setView(fitZoom, fitPan);
    }
  }, [venue, setView]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || !venue) return undefined;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      markInteracting();
      const bounds = getVenueContentBounds(venue);
      const { x: deltaX, y: deltaY } = normalizeWheelDelta(e.deltaX, e.deltaY, e.deltaMode);

      if (e.ctrlKey) {
        const currentZoom = useVenueStore.getState().zoom;
        const zoomFactor = Math.exp(-deltaY * 0.01);
        zoomAtPoint(container, bounds, currentZoom * zoomFactor, e.clientX, e.clientY);
      } else {
        const { zoom: currentZoom, pan: currentPan } = useVenueStore.getState();
        useVenueStore
          .getState()
          .setPan(
            clampPan(
              { x: currentPan.x - deltaX, y: currentPan.y - deltaY },
              currentZoom,
              bounds,
              container.clientWidth,
              container.clientHeight,
            ),
          );
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [venue, markInteracting]);

  const zoomByStep = (direction: 1 | -1) => {
    if (!venue) return;
    const rect = mapContainerRef.current?.getBoundingClientRect();
    const cx = rect ? rect.left + rect.width / 2 : 0;
    const cy = rect ? rect.top + rect.height / 2 : 0;
    zoomAtPoint(
      mapContainerRef.current,
      getVenueContentBounds(venue),
      zoom + direction * ZOOM_STEP,
      cx,
      cy,
    );
  };
  const handleZoomIn = () => {
    zoomByStep(1);
  };
  const handleZoomOut = () => {
    zoomByStep(-1);
  };
  const handleResetView = () => {
    if (!venue) return;
    useVenueStore.getState().setActiveSection(null);
    const { width, height } = getContainerSize(mapContainerRef.current);
    const { zoom: fitZoom, pan: fitPan } = computeFitView(
      getVenueContentBounds(venue),
      width,
      height,
    );
    setView(fitZoom, fitPan);
  };

  const pointerOriginRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const DRAG_START_THRESHOLD = 4;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    pointerOriginRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const origin = pointerOriginRef.current;
    if (!venue || origin?.pointerId !== e.pointerId) return;

    if (!isDragging) {
      const moved = Math.hypot(e.clientX - origin.x, e.clientY - origin.y);
      if (moved < DRAG_START_THRESHOLD) return;
      setIsDragging(true);
      try {
        mapContainerRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // no-op
      }
    }

    e.preventDefault();
    markInteracting();
    const { width, height } = getContainerSize(mapContainerRef.current);
    setPan(
      clampPan(
        { x: e.clientX - dragStart.x, y: e.clientY - dragStart.y },
        zoom,
        getVenueContentBounds(venue),
        width,
        height,
      ),
    );
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      try {
        mapContainerRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // no-op
      }
    }
    setIsDragging(false);
    pointerOriginRef.current = null;
  };

  if (loading)
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center justify-center gap-3 min-h-screen bg-slate-50"
      >
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
        <p className="text-sm text-gray-500">Loading seating map…</p>
      </div>
    );

  if (error)
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-4 min-h-screen bg-slate-50 px-6 text-center"
      >
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-red-600">
          <Icon name="close" className="w-6 h-6" />
        </div>
        <div>
          <h1 className="font-bold text-gray-900">Couldn&apos;t load the seating map</h1>
          <p className="text-sm text-gray-500 mt-1">{error}</p>
        </div>
        <button
          type="button"
          onClick={refetch}
          className="cursor-pointer bg-gray-900 text-white text-sm font-semibold px-5 py-2.5 rounded-xl shadow-sm hover:bg-gray-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          Try again
        </button>
      </div>
    );

  if (!venue)
    return (
      <div className="flex flex-col items-center justify-center gap-2 min-h-screen bg-slate-50 text-center px-6">
        <h1 className="font-bold text-gray-900">No venue data</h1>
        <p className="text-sm text-gray-500">There&apos;s nothing to show yet.</p>
      </div>
    );

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-gray-100 overflow-hidden">
      {/* Below `lg:`, the sidebar is a full-screen drawer rather than a
          persistent panel - a static 400px-wide sidebar leaves a tablet in
          portrait mode (e.g. 768px wide) with less than half its width for
          the map, which should stay the primary focus at every size below
          desktop/laptop. */}
      {!showSidebar && (
        <button
          onClick={() => {
            setShowSidebar(true);
          }}
          className="lg:hidden fixed top-4 left-4 z-60 bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg font-bold text-sm flex items-center gap-2"
        >
          <Icon name="menu" />
          Booking ({selectedSeatsCount})
        </button>
      )}

      <div
        className={`
        fixed lg:relative inset-0 lg:inset-auto z-55 lg:z-auto
        transition-all duration-300 ease-in-out lg:overflow-hidden
        ${showSidebar ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        ${sidebarCollapsed ? 'lg:w-0' : 'lg:w-100'}
        w-full
      `}
      >
        <div
          className={`relative h-full lg:w-100 transition-opacity duration-200 ${
            sidebarCollapsed ? 'lg:opacity-0' : 'lg:opacity-100'
          }`}
        >
          <IconButton
            icon="close"
            label="Close menu"
            onClick={() => {
              setShowSidebar(false);
            }}
            className="lg:hidden absolute top-4 right-4 z-10"
          />
          <BookingSummary venue={venue} />
        </div>
      </div>

      {/* One persistent button rather than two swapping in/out - it slides
          alongside the panel's own edge and its chevron rotates in place, so
          toggling reads as one continuous motion instead of a button
          vanishing and a different one popping in elsewhere. */}
      <IconButton
        icon="chevron-left"
        label={sidebarCollapsed ? 'Show panel' : 'Hide panel'}
        onClick={() => {
          setSidebarCollapsed(!sidebarCollapsed);
        }}
        className={`hidden lg:flex fixed top-4 z-50 transition-all! duration-300 ease-in-out ${
          sidebarCollapsed ? 'left-4' : 'left-[372px]'
        }`}
        iconClassName={`transition-transform duration-300 ease-in-out ${
          sidebarCollapsed ? 'rotate-180' : ''
        }`}
      />
      {/* Keeps looping the whole time the panel stays hidden (not a one-shot
          flash) - the button's own slide is easy to miss on its own, so this
          gives a continuous, unmistakable "the panel is hidden, click here
          to bring it back" cue for as long as that's true. A separate
          sibling element rather than a class on the button itself, so it
          can't interfere with the button's own slide/rotate transitions. */}
      {sidebarCollapsed && (
        <span
          aria-hidden="true"
          className="hidden lg:block fixed top-4 left-4 z-40 w-11 h-11 rounded-full bg-blue-500/60 motion-safe:animate-ping pointer-events-none"
        />
      )}

      {showSidebar && (
        <button
          type="button"
          aria-label="Close menu"
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => {
            setShowSidebar(false);
          }}
        />
      )}

      <main
        id="map-viewport"
        ref={mapContainerRef}
        // Below `lg:`, the sidebar becomes a full-screen drawer over the
        // map - inert while it's open so keyboard Tab can't reach the zoom
        // controls or seats hidden behind it (mirrors the same pattern used
        // for ConfirmDialog's backdrop).
        inert={showSidebar}
        className="flex-1 relative h-full bg-gray-200/50 overflow-hidden select-none"
        style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <VenueMap venue={venue} zoom={zoom} pan={pan} smooth={!isInteracting} />

        <div className="fixed right-4 md:right-8 bottom-4 md:bottom-8 flex flex-col gap-2 z-50">
          <IconButton icon="zoom-in" label="Zoom in" onClick={handleZoomIn} />
          <IconButton icon="zoom-out" label="Zoom out" onClick={handleZoomOut} />
          <IconButton
            icon="reset-view"
            label="Reset view"
            onClick={handleResetView}
            className="mt-2"
          />
        </div>
      </main>

      <Toast />
    </div>
  );
};

export default App;
