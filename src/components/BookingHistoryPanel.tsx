import { useMemo } from 'react';
import { useVenueStore } from '../store/seatStore';
import type { Booking } from '../store/seatStore';
import type { Venue } from '../interfaces/venue.interfaces';
import { buildSeatIndex } from '../utils/seatIndex';

interface BookingHistoryPanelProps {
  venue: Venue;
}

// Five roughly-88px cards plus gaps, then scroll - a fixed cap rather than a
// dynamic count so the sidebar's own height never changes as history grows.
const VISIBLE_BOOKINGS = 5;
const CARD_HEIGHT_PX = 88;
const GAP_PX = 12;
const LIST_MAX_HEIGHT = VISIBLE_BOOKINGS * CARD_HEIGHT_PX + (VISIBLE_BOOKINGS - 1) * GAP_PX;

export default function BookingHistoryPanel({ venue }: BookingHistoryPanelProps) {
  const bookings = useVenueStore((s) => s.bookings);
  const viewingBookingId = useVenueStore((s) => s.viewingBookingId);
  const viewBooking = useVenueStore((s) => s.viewBooking);
  const clearViewingBooking = useVenueStore((s) => s.clearViewingBooking);
  const setActiveSection = useVenueStore((s) => s.setActiveSection);
  const setZoom = useVenueStore((s) => s.setZoom);

  const seatIndex = useMemo(() => buildSeatIndex(venue), [venue]);

  const handleBookingClick = (booking: Booking) => {
    if (viewingBookingId === booking.id) {
      // Clicking the already-active booking again closes it out, matching
      // the same open/close toggle a section itself uses.
      clearViewingBooking();
      setActiveSection(null);
      return;
    }

    const firstSeatId = booking.seatIds[0];
    const firstEntry = firstSeatId ? seatIndex.get(firstSeatId) : undefined;
    if (firstEntry) {
      setActiveSection(firstEntry.sectionId);
      setZoom(8); // Matches Section.tsx's own zoom-in level.
    }
    viewBooking(booking.id);
  };

  return (
    <div>
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">
        Booking History
      </h2>

      {bookings.length === 0 ? (
        <div className="text-center py-10 text-gray-400 flex flex-col items-center gap-3">
          <svg
            width="56"
            height="40"
            viewBox="0 0 56 40"
            fill="none"
            aria-hidden="true"
            className="text-gray-300"
          >
            <rect x="2" y="2" width="12" height="10" rx="2" fill="currentColor" />
            <rect x="22" y="2" width="12" height="10" rx="2" fill="currentColor" />
            <rect x="42" y="2" width="12" height="10" rx="2" fill="currentColor" />
            <rect x="12" y="20" width="12" height="10" rx="2" fill="currentColor" />
            <rect x="32" y="20" width="12" height="10" rx="2" fill="currentColor" />
          </svg>
          <p>No bookings yet</p>
        </div>
      ) : (
        <div
          className="space-y-3 overflow-y-auto pr-1"
          style={{ maxHeight: `${LIST_MAX_HEIGHT}px` }}
        >
          {bookings.map((booking) => {
            const sectionLabels = Array.from(
              new Set(
                booking.seatIds
                  .map((id) => seatIndex.get(id)?.sectionLabel)
                  .filter((label): label is string => Boolean(label)),
              ),
            );
            // Destructuring (rather than checking `sectionLabels.length`) is
            // what lets TypeScript actually narrow `firstLabel` to `string`
            // below - indexed access alone stays `string | undefined` under
            // noUncheckedIndexedAccess even inside a length check.
            const [firstLabel, ...restLabels] = sectionLabels;
            const primaryLabel = firstLabel
              ? restLabels.length > 0
                ? `${firstLabel} +${restLabels.length} more`
                : firstLabel
              : 'Unknown section';
            const isActive = viewingBookingId === booking.id;

            return (
              <button
                key={booking.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  handleBookingClick(booking);
                }}
                className={`w-full text-left p-3 rounded-lg shadow-sm border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
                  isActive
                    ? 'border-2 border-blue-600 bg-blue-50'
                    : 'border border-gray-100 bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex justify-between items-baseline">
                  <p className="text-sm font-semibold text-gray-800">
                    {new Date(booking.createdAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                  <span className="text-xs font-medium text-gray-500 shrink-0 ml-2">
                    {booking.seatIds.length} seat{booking.seatIds.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <p className="text-xs text-gray-500">{primaryLabel}</p>
                  <span className="font-bold text-gray-900">${booking.total}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
