import VenueMap from './components/VenueMap';
import { useVenue } from './hooks/useVenue';
import BookingSummary from './components/BookingSummary';
import { useEffect, useState, useRef } from 'react';
import { useVenueStore } from './store/seatStore';

const App = () => {
  const { venue, error, loading } = useVenue();
  const zoom = useVenueStore((s) => s.zoom);
  const setZoom = useVenueStore((s) => s.setZoom);
  const selectedSeatsCount = useVenueStore((s) => s.selectedSeats.size);
  const [showSidebar, setShowSidebar] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (venue) {
      const availableWidth = window.innerWidth - (window.innerWidth >= 768 ? 400 : 0) - 64;
      const fitScale = Math.min(availableWidth / venue.map.width, 1);

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
          setZoom(1.5); // Zoom into the section
          return; // Skip default zoom
        }
      }

      setZoom(Math.max(fitScale, 0.2));
    }
  }, [venue, setZoom]);

  const handleZoomIn = () => setZoom(Math.min(zoom + 0.2, 3));
  const handleZoomOut = () => setZoom(Math.max(zoom - 0.2, 0.2));

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
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
      </div>
    );
  if (error) return <div className="text-red-500 text-center p-4">Error: {error}</div>;
  if (!venue) return <div className="text-center p-4">No venue data</div>;

  return (
    <div className="flex flex-col md:flex-row h-screen bg-gray-100 overflow-hidden">
      <button
        onClick={() => setShowSidebar(!showSidebar)}
        className="md:hidden fixed top-4 left-4 z-[60] bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg font-bold text-sm flex items-center gap-2"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M4 6h16M4 12h16M4 18h16"
          ></path>
        </svg>
        Booking ({selectedSeatsCount})
      </button>

      <div
        className={`
        fixed md:relative inset-0 md:inset-auto z-50 md:z-auto
        transform transition-transform duration-300 ease-in-out
        ${showSidebar ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        md:w-[400px] w-full
      `}
      >
        <div className="relative h-full">
          <button
            onClick={() => setShowSidebar(false)}
            className="md:hidden absolute top-4 right-4 z-10 bg-white rounded-full p-2 shadow-lg"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              ></path>
            </svg>
          </button>
          <BookingSummary venue={venue} />
        </div>
      </div>

      {showSidebar && (
        <button
          type="button"
          aria-label="Close menu"
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- mouse-drag panning is a progressive enhancement over native scroll; seats remain keyboard-navigable */}
      <main
        ref={mapContainerRef}
        className="flex-1 relative h-full bg-gray-200/50 overflow-auto select-none"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <div className="p-4 md:p-8  inline-block min-w-full min-h-full">
          <VenueMap venue={venue} zoom={zoom} />
        </div>

        <div className="fixed right-4 md:right-8 bottom-4 md:bottom-8 flex flex-col gap-2 z-50">
          <button
            onClick={handleZoomIn}
            className="cursor-pointer bg-white hover:bg-gray-50 text-gray-700 p-2 md:p-3 rounded-full shadow-lg border border-gray-200 transition-colors"
            title="Zoom In"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <button
            onClick={handleZoomOut}
            className="cursor-pointer bg-white hover:bg-gray-50 text-gray-700 p-2 md:p-3 rounded-full shadow-lg border border-gray-200 transition-colors"
            title="Zoom Out"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        </div>
      </main>
    </div>
  );
};

export default App;
