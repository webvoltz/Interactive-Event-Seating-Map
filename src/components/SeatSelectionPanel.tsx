import { useMemo, useState } from 'react';
import { useVenueStore } from '../store/seatStore';
import type { Venue } from '../interfaces/venue.interfaces';
import { buildSeatIndex } from '../utils/seatIndex';
import ConfirmDialog from './ConfirmDialog';
import CheckoutTimer from './CheckoutTimer';

interface SeatSelectionPanelProps {
  venue: Venue;
}

export default function SeatSelectionPanel({ venue }: SeatSelectionPanelProps) {
  const selectedSeats = useVenueStore((s) => s.selectedSeats);
  const clearSelection = useVenueStore((s) => s.clearSelection);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const seatIndex = useMemo(() => buildSeatIndex(venue), [venue]);

  const handleClear = () => {
    clearSelection();
    setShowClearConfirm(false);
  };

  const selectedSeatDetails = useMemo(() => {
    const details: { id: string; label: string; price: number; tierName: string }[] = [];
    selectedSeats.forEach((seatId) => {
      const entry = seatIndex.get(seatId);
      if (!entry) return;
      details.push({
        id: seatId,
        label: `${entry.sectionLabel} | Row ${entry.rowLabel} | Seat ${entry.seatCol}`,
        price: entry.price,
        tierName: entry.tierName,
      });
    });
    return details;
  }, [seatIndex, selectedSeats]);

  return (
    <div>
      <CheckoutTimer />
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex justify-between items-center">
        <span>Selected Seats ({selectedSeats.size}/8)</span>
        {selectedSeats.size > 0 && (
          <button
            onClick={() => {
              setShowClearConfirm(true);
            }}
            className="cursor-pointer text-red-500 hover:text-red-600 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            Clear
          </button>
        )}
      </h2>

      <div className="space-y-3">
        {selectedSeatDetails.map((item) => (
          <div
            key={item.id}
            className="bg-white p-3 rounded-lg shadow-sm border border-gray-100 flex justify-between items-center"
          >
            <div>
              <p className="text-sm font-semibold text-gray-800">{item.label}</p>
              <p className="text-xs text-gray-500">{item.tierName}</p>
            </div>
            <span className="font-bold text-gray-900"> ${item.price}</span>
          </div>
        ))}
      </div>

      {showClearConfirm && (
        <ConfirmDialog
          title="Clear all selected seats?"
          message={`This removes all ${selectedSeats.size} selected seat${selectedSeats.size === 1 ? '' : 's'} from your cart. This can't be undone.`}
          confirmLabel="Clear"
          onConfirm={handleClear}
          onCancel={() => {
            setShowClearConfirm(false);
          }}
        />
      )}
    </div>
  );
}
