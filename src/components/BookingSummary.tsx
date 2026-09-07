import { useVenueStore } from '../store/seatStore';
import type { Venue } from '../interfaces/venue.interfaces';
import { useMemo, useState } from 'react';

interface BookingSummaryProps {
  venue: Venue;
}

export default function BookingSummary({ venue }: BookingSummaryProps) {
  const selectedSeats = useVenueStore((s) => s.selectedSeats);
  const clearSelection = useVenueStore((s) => s.clearSelection);
  const [confirmedTotal, setConfirmedTotal] = useState<number | null>(null);

  const handleClear = () => {
    setConfirmedTotal(null);
    clearSelection();
  };

  // Get selected seat details
  const selectedSeatDetails = useMemo(() => {
    const details: { id: string; label: string; price: number; tier: number }[] = [];
    if (selectedSeats.size === 0) return details;

    const tierPrices: Record<number, number> = {
      1: 7000,
      2: 3000,
      3: 1500,
    };

    venue.sections.forEach((section) => {
      section.rows.forEach((row) => {
        row.seats.forEach((seat) => {
          if (selectedSeats.has(seat.id)) {
            details.push({
              id: seat.id,
              label: `${section.label} | Row ${row.index} | Seat ${seat.col}`,
              price: tierPrices[seat.priceTier] || 50,
              tier: seat.priceTier,
            });
          }
        });
      });
    });
    return details;
  }, [venue, selectedSeats]);

  const total = selectedSeatDetails.reduce((sum, item) => sum + item.price, 0);

  return (
    <div className="w-full md:w-[400px] h-auto md:h-full bg-white border-r border-gray-200 shadow-xl z-20 flex flex-col">
      <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-blue-400 to-indigo-400 text-white shadow-md">
        <h1 className="text-2xl font-black tracking-tight uppercase italic mb-1 text-white drop-shadow-md">
          {venue?.name}
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-3">
            Price Tiers
          </h3>
          <div className="space-y-2 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 rounded-sm border-2 border-yellow-500 bg-white"></div>
                <span className="text-xs text-gray-700">Tier 1</span>
              </div>
              <span className="text-xs font-bold text-gray-900">7000$</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 rounded-sm border-2 border-gray-500 bg-white"></div>
                <span className="text-xs text-gray-700">Tier 2</span>
              </div>
              <span className="text-xs font-bold text-gray-900">3000$</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 rounded-sm border-2 border-orange-500 bg-white"></div>
                <span className="text-xs text-gray-700">Tier 3</span>
              </div>
              <span className="text-xs font-bold text-gray-900">1500$</span>
            </div>
          </div>

          <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-3 mt-4 pt-3 border-t border-gray-200">
            Seat Status
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-green-500"></div>
              <span className="text-xs text-gray-700">Selected</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-gray-300"></div>
              <span className="text-xs text-gray-700">Sold</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-amber-400"></div>
              <span className="text-xs text-gray-700">Reserved</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-red-400"></div>
              <span className="text-xs text-gray-700">Held</span>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex justify-between items-center">
            <span>Selected Seats ({selectedSeats.size}/8)</span>
            {selectedSeats.size > 0 && (
              <button
                onClick={handleClear}
                className="cursor-pointer text-red-500 hover:text-red-600 hover:underline"
              >
                Clear
              </button>
            )}
          </h3>

          {selectedSeats.size === 0 ? (
            <div className="text-center py-10 text-gray-400 flex flex-col items-center">
              <p>Select seats from the map</p>
            </div>
          ) : (
            <div className="space-y-3">
              {selectedSeatDetails.map((item) => (
                <div
                  key={item.id}
                  className="bg-white p-3 rounded-lg shadow-sm border border-gray-100 flex justify-between items-center"
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{item.label}</p>
                    <p className="text-xs text-gray-500">Standard Ticket</p>
                  </div>
                  <span className="font-bold text-gray-900"> {item.price}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-6 bg-white border-t border-gray-200 mt-auto">
          <div className="flex justify-between items-center mb-6">
            <span className="text-gray-600">Total Amount</span>
            <span className="text-2xl font-bold text-gray-900">{total}$</span>
          </div>
          {confirmedTotal !== null ? (
            <div
              role="status"
              className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-center"
            >
              <p className="font-bold text-emerald-700">
                Booking confirmed &mdash; {confirmedTotal}$
              </p>
              <p className="text-xs text-emerald-600 mt-1">A confirmation has been sent to you.</p>
            </div>
          ) : (
            <button
              disabled={selectedSeats.size === 0}
              onClick={() => setConfirmedTotal(total)}
              className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg transition-all transform active:scale-95
                        ${
                          selectedSeats.size > 0
                            ? 'cursor-pointer bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:from-green-600 hover:to-emerald-700 shadow-green-200'
                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        }`}
            >
              Proceed to Pay
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
