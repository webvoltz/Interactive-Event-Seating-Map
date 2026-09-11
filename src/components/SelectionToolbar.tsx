import { useMemo } from 'react';
import { useVenueStore } from '../store/seatStore';
import type { Venue } from '../interfaces/venue.interfaces';
import { buildSeatIndex } from '../utils/seatIndex';
import { useCountdown } from '../hooks/useCountdown';
import { formatCountdown } from '../utils/formatCountdown';
import Icon from './Icon';

interface SelectionToolbarProps {
  venue: Venue;
}

export default function SelectionToolbar({ venue }: SelectionToolbarProps) {
  const selectedSeats = useVenueStore((s) => s.selectedSeats);
  const clearSelection = useVenueStore((s) => s.clearSelection);
  const selectionExpiresAt = useVenueStore((s) => s.selectionExpiresAt);
  const remaining = useCountdown(selectionExpiresAt);

  const seatIndex = useMemo(() => buildSeatIndex(venue), [venue]);
  const total = useMemo(() => {
    let sum = 0;
    selectedSeats.forEach((seatId) => {
      sum += seatIndex.get(seatId)?.price ?? 0;
    });
    return sum;
  }, [seatIndex, selectedSeats]);

  if (selectedSeats.size === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label="Seat selection"
      className="fixed bottom-20 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl bg-gray-900 px-4 py-2.5 text-white shadow-2xl"
    >
      <span className="whitespace-nowrap text-sm font-semibold">
        {selectedSeats.size} seat{selectedSeats.size === 1 ? '' : 's'} selected
      </span>

      <span className="hidden h-5 w-px bg-white/20 sm:block" aria-hidden="true" />
      <span className="whitespace-nowrap text-sm font-bold">${total}</span>

      {remaining !== null && (
        <>
          <span className="hidden h-5 w-px bg-white/20 sm:block" aria-hidden="true" />
          <span className="flex items-center gap-1 whitespace-nowrap text-xs text-white/70">
            <Icon name="clock" className="h-3.5 w-3.5" />
            {formatCountdown(remaining)}
          </span>
        </>
      )}

      <span className="hidden h-5 w-px bg-white/20 sm:block" aria-hidden="true" />
      <button
        type="button"
        onClick={() => {
          clearSelection();
        }}
        className="cursor-pointer flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold text-red-300 transition-colors hover:bg-white/10 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
      >
        <Icon name="close" className="h-3.5 w-3.5" />
        Remove
      </button>
    </div>
  );
}
