import { useEffect, useMemo, useState } from 'react';
import { useVenueStore } from '../store/seatStore';
import type { Venue } from '../interfaces/venue.interfaces';
import { buildSeatIndex, getTier } from '../utils/seatIndex';
import SeatSelectionPanel from './SeatSelectionPanel';
import SeatSelectionFooter from './SeatSelectionFooter';
import BookingHistoryPanel from './BookingHistoryPanel';
import BestSeatsFinder from './BestSeatsFinder';

interface BookingSummaryProps {
  venue: Venue;
}

const CONFIRMATION_DISPLAY_MS = 3000;

export default function BookingSummary({ venue }: BookingSummaryProps) {
  const selectedSeats = useVenueStore((s) => s.selectedSeats);
  const confirmPurchase = useVenueStore((s) => s.confirmPurchase);
  const [confirmedTotal, setConfirmedTotal] = useState<number | null>(null);

  useEffect(() => {
    if (confirmedTotal === null) return;
    const timer = setTimeout(() => {
      setConfirmedTotal(null);
    }, CONFIRMATION_DISPLAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [confirmedTotal]);

  const handleConfirmPurchase = (total: number) => {
    const booking = confirmPurchase(total);
    if (booking) setConfirmedTotal(total);
  };

  const showSelectionPanel = selectedSeats.size > 0 || confirmedTotal !== null;

  const seatIndex = useMemo(() => buildSeatIndex(venue), [venue]);
  const total = useMemo(() => {
    let sum = 0;
    selectedSeats.forEach((seatId) => {
      sum += seatIndex.get(seatId)?.price ?? 0;
    });
    return sum;
  }, [seatIndex, selectedSeats]);

  return (
    <div className="w-full lg:w-100 h-full bg-white border-r border-gray-200 shadow-xl z-20 flex flex-col">
      <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-brand-from to-brand-to text-white shadow-md">
        <h1 className="text-2xl font-bold tracking-tight mb-1 text-white">{venue.name}</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <BestSeatsFinder venue={venue} />

        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <h2 className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-3">
            Price Tiers
          </h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 rounded-sm border-2 border-tier-1 bg-white"></div>
                <span className="text-xs text-gray-700">{getTier(1).name}</span>
              </div>
              <span className="text-xs font-bold text-gray-900">${getTier(1).price}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 rounded-sm border-2 border-tier-2 bg-white"></div>
                <span className="text-xs text-gray-700">{getTier(2).name}</span>
              </div>
              <span className="text-xs font-bold text-gray-900">${getTier(2).price}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 rounded-sm border-2 border-tier-3 bg-white"></div>
                <span className="text-xs text-gray-700">{getTier(3).name}</span>
              </div>
              <span className="text-xs font-bold text-gray-900">${getTier(3).price}</span>
            </div>
          </div>
        </div>

        {showSelectionPanel ? (
          <SeatSelectionPanel venue={venue} />
        ) : (
          <BookingHistoryPanel venue={venue} />
        )}
      </div>

      {showSelectionPanel && (
        <SeatSelectionFooter
          total={total}
          confirmedTotal={confirmedTotal}
          onConfirmPurchase={handleConfirmPurchase}
        />
      )}
    </div>
  );
}
