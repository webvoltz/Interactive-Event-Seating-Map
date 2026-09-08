import VenueMap from './components/VenueMap';
import { useVenue } from './hooks/useVenue';
import BookingSummary from './components/BookingSummary';
import Toast from './components/Toast';
import Icon from './components/Icon';
import IconButton from './components/IconButton';
import { useEffect, useState, useRef } from 'react';
import { useVenueStore } from './store/seatStore';
import type { Venue } from './interfaces/venue.interfaces';
import { getVenueContentBounds } from './utils/venueBounds';

const ZOOM_STEP = 0.2;
const MIN_ZOOM = 0.2;

// A small guaranteed buffer so the fitted content never lands close enough
// to the container's edge to force a scrollbar on its own (measuring
// clientWidth/Height before a scrollbar appears vs. after one is added is a
// classic layout feedback loop - this sidesteps it instead of chasing exact
// pixels).
const FIT_SAFETY_MARGIN = 0.96;

// Fit to the venue's actual rendered content (see getVenueContentBounds) so
// the arena fills the viewport instead of sitting small inside the map
// canvas's built-in panning margin. Shared by the initial-load effect and
// the "reset view" button so they can't drift out of sync with each other.
function computeFitZoom(venue: Venue, container: HTMLDivElement | null): number {
  const availableWidth = container
    ? container.clientWidth - 64
    : window.innerWidth - (window.innerWidth >= 768 ? 400 : 0) - 64;
  const availableHeight = container ? container.clientHeight - 64 : window.innerHeight - 64;

  const bounds = getVenueContentBounds(venue);
  const fitScale = Math.min(availableWidth / bounds.width, availableHeight / bounds.height, 4);
  return Math.max(fitScale * FIT_SAFETY_MARGIN, MIN_ZOOM);
}

const App = () => {
  const { venue, error, loading, refetch } = useVenue();
  const zoom = useVenueStore((s) => s.zoom);
  const setZoom = useVenueStore((s) => s.setZoom);
  const selectedSeatsCount = useVenueStore((s) => s.selectedSeats.size);
  const [showSidebar, setShowSidebar] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

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
          setZoom(8); // Zoom into the section, matching Section.tsx's own zoom-in
          return; // Skip default zoom
        }
      }

      setZoom(computeFitZoom(venue, mapContainerRef.current));
    }
  }, [venue, setZoom]);

  // Zooming doesn't try to keep any point centered - only the initial load
  // does (see the effect above). The user pans/scrolls freely afterward.
  const handleZoomIn = () => setZoom(zoom + ZOOM_STEP);
  const handleZoomOut = () => setZoom(Math.max(zoom - ZOOM_STEP, MIN_ZOOM));
  const handleResetView = () => {
    if (!venue) return;
    useVenueStore.getState().setActiveSection(null);
    setZoom(computeFitZoom(venue, mapContainerRef.current));
  };

  // Mouse drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (mapContainerRef.current) {
      setIsDragging(true);
      setDragStart({
        x: e.clientX + mapContainerRef.current.scrollLeft,
        y: e.clientY + mapContainerRef.current.scrollTop,
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !mapContainerRef.current) return;

    e.preventDefault();
    const x = e.clientX;
    const y = e.clientY;

    mapContainerRef.current.scrollLeft = dragStart.x - x;
    mapContainerRef.current.scrollTop = dragStart.y - y;
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
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
          onClick={() => setShowSidebar(true)}
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
            onClick={() => setShowSidebar(false)}
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
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
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
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- mouse-drag panning is a progressive enhancement over native scroll; seats remain keyboard-navigable */}
      <main
        ref={mapContainerRef}
        // Below `lg:`, the sidebar becomes a full-screen drawer over the
        // map - inert while it's open so keyboard Tab can't reach the zoom
        // controls or seats hidden behind it (mirrors the same pattern used
        // for ConfirmDialog's backdrop).
        inert={showSidebar}
        className="flex-1 relative h-full bg-gray-200/50 overflow-auto select-none"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <div className="p-4 md:p-8 flex items-center-safe justify-center-safe min-w-full min-h-full">
          <VenueMap venue={venue} zoom={zoom} />
        </div>

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
