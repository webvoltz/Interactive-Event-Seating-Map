import { useVenueStore } from '../store/seatStore';

interface SeatSelectionFooterProps {
  total: number;
  confirmedTotal: number | null;
  onConfirmPurchase: (total: number) => void;
}

// Rendered outside the sidebar's scrollable region (see BookingSummary.tsx)
// so Total Amount / Proceed to Pay stay reachable without scrolling past
// however many seats are currently selected.
export default function SeatSelectionFooter({
  total,
  confirmedTotal,
  onConfirmPurchase,
}: SeatSelectionFooterProps) {
  const selectedSeatsCount = useVenueStore((s) => s.selectedSeats.size);

  return (
    <div className="p-6 bg-white border-t border-gray-200 shrink-0">
      <div className="flex justify-between items-center mb-6">
        <span className="text-gray-600">Total Amount</span>
        <span className="text-2xl font-bold text-gray-900">${total}</span>
      </div>
      {confirmedTotal !== null ? (
        <div
          role="status"
          className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-center"
        >
          <p className="font-bold text-emerald-700">Booking confirmed &mdash; {confirmedTotal}$</p>
          <p className="text-xs text-emerald-600 mt-1">A confirmation has been sent to you.</p>
        </div>
      ) : (
        <button
          disabled={selectedSeatsCount === 0}
          onClick={() => {
            onConfirmPurchase(total);
          }}
          className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg transition-all transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2
                    ${
                      selectedSeatsCount > 0
                        ? 'cursor-pointer bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:from-green-600 hover:to-emerald-700 shadow-green-200'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
        >
          Proceed to Pay
        </button>
      )}
    </div>
  );
}
