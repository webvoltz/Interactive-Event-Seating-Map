import { useState } from 'react';
import { MAX_SELECTABLE_SEATS, useVenueStore } from '../store/seatStore';
import type { Venue } from '../interfaces/venue.interfaces';
import { findBestSeats } from '../utils/findBestSeats';
import type { SeatBlock, SeatPriority } from '../utils/findBestSeats';
import Icon from './Icon';
import ConfirmDialog from './ConfirmDialog';

interface BestSeatsFinderProps {
  venue: Venue;
}

const PRIORITY_LABELS: Record<SeatPriority, string> = {
  view: 'Best view',
  price: 'Best price',
};

const PARTY_SIZE_OPTIONS = Array.from({ length: MAX_SELECTABLE_SEATS }, (_, i) => i + 1);

function describeBlock(block: SeatBlock): string {
  const seatCount = block.seatIds.length;
  const seatWord = seatCount === 1 ? 'seat' : 'seats';
  const seatRange =
    block.startCol === block.endCol
      ? `Seat ${block.startCol}`
      : `Seats ${block.startCol}-${block.endCol}`;
  return `Found ${seatCount} ${seatWord} - ${block.sectionLabel} · Row ${block.rowLabel} · ${seatRange} · $${block.totalPrice}`;
}

export default function BestSeatsFinder({ venue }: BestSeatsFinderProps) {
  const selectedSeatsCount = useVenueStore((s) => s.selectedSeats.size);
  const selectSeatBlock = useVenueStore((s) => s.selectSeatBlock);
  const setFeedback = useVenueStore((s) => s.setFeedback);
  const [partySize, setPartySize] = useState(2);
  const [priority, setPriority] = useState<SeatPriority>('view');
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);

  const runSearch = () => {
    const { soldSeats } = useVenueStore.getState();
    const block = findBestSeats(
      venue,
      partySize,
      priority,
      (seat) => seat.status === 'available' && !soldSeats.has(seat.id),
    );

    if (!block) {
      setFeedback({
        type: 'error',
        message: `No block of ${partySize} adjacent seats is available. Try a smaller party size.`,
      });
      return;
    }

    // Selection first, then the description - so if selectSeatBlock ever
    // refused (it can't here: findBestSeats never returns more than
    // MAX_SELECTABLE_SEATS seats since partySize is capped by the <select>
    // below), the success copy wouldn't overwrite a real error.
    selectSeatBlock(block.seatIds, block.sectionId);
    setFeedback({ type: 'info', message: describeBlock(block) });
  };

  const handleSubmit = (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (selectedSeatsCount > 0) {
      setShowReplaceConfirm(true);
      return;
    }
    runSearch();
  };

  return (
    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
      <h2 className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-3">
        Find Best Seats
      </h2>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="best-seats-party-size" className="block text-xs text-gray-600 mb-1">
            Party size
          </label>
          <select
            id="best-seats-party-size"
            value={partySize}
            onChange={(e) => {
              setPartySize(Number(e.target.value));
            }}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            {PARTY_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} {size === 1 ? 'seat' : 'seats'}
              </option>
            ))}
          </select>
        </div>

        <fieldset>
          <legend className="text-xs text-gray-600 mb-1">Priority</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['view', 'price'] as const).map((option) => (
              <label key={option} className="relative cursor-pointer">
                <input
                  type="radio"
                  name="best-seats-priority"
                  value={option}
                  checked={priority === option}
                  onChange={() => {
                    setPriority(option);
                  }}
                  className="peer sr-only"
                />
                <span className="block rounded-lg border border-gray-200 bg-white px-3 py-2 text-center text-xs font-semibold text-gray-600 peer-checked:border-2 peer-checked:border-blue-600 peer-checked:bg-blue-50 peer-checked:text-blue-700 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-600 peer-focus-visible:ring-offset-2">
                  {PRIORITY_LABELS[option]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <button
          type="submit"
          aria-describedby="best-seats-hint"
          className="cursor-pointer w-full flex items-center justify-center gap-2 rounded-xl bg-gray-900 text-white text-sm font-semibold px-4 py-2.5 shadow-sm hover:bg-gray-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          <Icon name="search" className="w-4 h-4" />
          Find best seats
        </button>
        <p id="best-seats-hint" className="text-[11px] text-gray-400 text-center">
          Replaces your current selection.
        </p>
      </form>

      {showReplaceConfirm && (
        <ConfirmDialog
          title="Replace your current selection?"
          message="Finding new seats replaces every seat currently in your cart."
          confirmLabel="Replace"
          onConfirm={() => {
            setShowReplaceConfirm(false);
            runSearch();
          }}
          onCancel={() => {
            setShowReplaceConfirm(false);
          }}
        />
      )}
    </div>
  );
}
