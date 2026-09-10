import { memo, useMemo } from 'react';
import type { ISeat, Row } from '../interfaces/venue.interfaces';
import { useVenueStore } from '../store/seatStore';
import { rowLetter } from '../utils/rowLetter';
import { getTier } from '../utils/seatIndex';
import {
  SEAT_STATUS_STYLE,
  describeSeatStatus,
  isSeatSelectable,
  resolveSeatStatus,
} from '../utils/seatStatus';

interface SeatsProps {
  rows: Row[];
}

const TIER_STROKE: Record<number, string> = {
  1: 'var(--color-tier-1)',
  2: 'var(--color-tier-2)',
  3: 'var(--color-tier-3)',
};

// A near-square seat with a light radius reads as a seat, not a dot, once
// zoomed in - a plain circle-reading dot only happened because the previous
// rx (0.5) was half the shape's own width, which looks circular at any scale.
const SEAT_SIZE = 3;
const SEAT_RADIUS = 0.35;

// Seat numbers/row letters are only worth mounting once they'd actually be
// legible - below this zoom they'd just be illegible flyspecks, so skip the
// extra ~1,500 text nodes entirely rather than render invisible detail.
const LABEL_ZOOM_THRESHOLD = 2;

const Seats = memo(function Seats({ rows }: SeatsProps) {
  const selectedSeats = useVenueStore((s) => s.selectedSeats);
  const soldSeats = useVenueStore((s) => s.soldSeats);
  const holds = useVenueStore((s) => s.holds);
  const simulationSeeded = useVenueStore((s) => s.simulationSeeded);
  const bookings = useVenueStore((s) => s.bookings);
  const viewingBookingId = useVenueStore((s) => s.viewingBookingId);
  const toggleSeat = useVenueStore((s) => s.toggleSeat);
  const setFeedback = useVenueStore((s) => s.setFeedback);
  // A boolean selector, not the raw zoom value - all ~1,500 seats in the
  // active section would otherwise re-render on every wheel/zoom event
  // (Zustand's default equality is Object.is, so a boolean that doesn't
  // change produces no re-render; the raw zoom number changes constantly).
  const showLabels = useVenueStore((s) => s.zoom >= LABEL_ZOOM_THRESHOLD);

  // Computed once per render of this component, not once per seat - a
  // countdown-precision read isn't needed here, just "is this hold still
  // live right now".
  const now = Date.now();

  // Seats belonging to whichever past booking is currently being viewed
  // from Booking History, if any - highlighted on top of their normal
  // status coloring (almost always "sold") rather than replacing it.
  const highlightedSeatIds = useMemo(() => {
    if (!viewingBookingId) return null;
    const booking = bookings.find((b) => b.id === viewingBookingId);
    return booking ? new Set(booking.seatIds) : null;
  }, [bookings, viewingBookingId]);

  const handleInteraction = (
    e: React.MouseEvent<SVGGElement> | React.KeyboardEvent<SVGGElement>,
    seat: ISeat,
    isUnavailable: boolean,
  ) => {
    e.stopPropagation();
    if (!isUnavailable) {
      toggleSeat(seat.id);
      e.currentTarget.focus();
    } else {
      // A seat can go from available to held between paint and click now
      // (another tab, or the simulation) - a silent no-op would look broken
      // in exactly that case, so say why nothing happened.
      setFeedback({ type: 'error', message: 'That seat is no longer available.' });
    }
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<SVGGElement>,
    seat: ISeat,
    rowIndex: number,
    seatIndex: number,
    isUnavailable: boolean,
  ) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleInteraction(e, seat, isUnavailable);
      return;
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      let nextRowIdx = rowIndex;
      let nextSeatIdx = seatIndex;

      if (e.key === 'ArrowRight') nextSeatIdx++;
      if (e.key === 'ArrowLeft') nextSeatIdx--;
      if (e.key === 'ArrowUp') nextRowIdx++;
      if (e.key === 'ArrowDown') nextRowIdx--;

      if (nextRowIdx >= 0 && nextRowIdx < rows.length) {
        const targetRowSeats = rows[nextRowIdx]?.seats;
        const firstSeat = targetRowSeats?.[0];
        if (!targetRowSeats || !firstSeat) return;

        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          let closest = firstSeat;
          let minDiff = Math.abs(closest.x - seat.x);

          targetRowSeats.forEach((s) => {
            const diff = Math.abs(s.x - seat.x);
            if (diff < minDiff) {
              minDiff = diff;
              closest = s;
            }
          });
          document.getElementById(`seat-${closest.id}`)?.focus();
        } else {
          const currentRow = rows[rowIndex];
          if (currentRow && nextSeatIdx >= 0 && nextSeatIdx < currentRow.seats.length) {
            const targetSeat = currentRow.seats[nextSeatIdx];
            if (targetSeat) {
              document.getElementById(`seat-${targetSeat.id}`)?.focus();
            }
          }
        }
      }
    }
  };

  return (
    <>
      {rows.map((row, rowIndex) =>
        row.seats.map((seat, seatIndex) => {
          const status = resolveSeatStatus(seat, {
            soldSeats,
            holds,
            selectedSeats,
            now,
            simulationSeeded,
          });
          const isSelected = status === 'selected';
          const isUnavailable = !isSeatSelectable(status);

          const style = SEAT_STATUS_STYLE[status];
          const { fill, textColor } = style;
          let { stroke, strokeWidth } = style;
          // The only piece of styling the status table can't express - an
          // available seat's stroke depends on its own price tier, not
          // just its status.
          if (status === 'available') {
            stroke = TIER_STROKE[seat.priceTier] ?? stroke;
          }

          const isHighlighted = highlightedSeatIds?.has(seat.id) ?? false;
          if (isHighlighted) {
            // Layered on top of whatever status color already applies
            // (almost always "sold") rather than replacing it, so the seat
            // still reads as sold while also standing out as "part of the
            // booking you're viewing".
            stroke = 'var(--color-booking-highlight)';
            strokeWidth = 0.5;
          }

          const label = `Row ${rowLetter(rowIndex)} Seat ${seat.col}, Price $${getTier(seat.priceTier).price}, ${describeSeatStatus(status)}`;

          return (
            <g
              key={seat.id}
              id={`seat-${seat.id}`}
              onClick={(e) => {
                handleInteraction(e, seat, isUnavailable);
              }}
              onKeyDown={(e) => {
                handleKeyDown(e, seat, rowIndex, seatIndex, isUnavailable);
              }}
              role="checkbox"
              aria-checked={isSelected}
              aria-label={label}
              aria-disabled={isUnavailable}
              tabIndex={isUnavailable ? -1 : 0}
              className="focus:outline-none group/seat"
            >
              <rect
                x={seat.x - SEAT_SIZE / 2}
                y={seat.y - SEAT_SIZE / 2}
                width={SEAT_SIZE}
                height={SEAT_SIZE}
                rx={SEAT_RADIUS}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                className={[
                  // A thin, clearly-visible ring - not thick enough to
                  // swallow most of the seat's own fill/number the way a
                  // near-half-width stroke would.
                  !isUnavailable &&
                    'group-focus/seat:stroke-blue-600 group-focus/seat:stroke-[0.5px]',
                  isSelected && 'seat-select-pop',
                  isHighlighted && 'seat-highlight-pulse',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  cursor: isUnavailable ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  outline: 'none',
                }}
              />
              {showLabels && (
                <text
                  x={seat.x}
                  y={seat.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={textColor}
                  fontSize={SEAT_SIZE * 0.5}
                  fontWeight={600}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {seat.col}
                </text>
              )}
            </g>
          );
        }),
      )}
      {showLabels &&
        rows.map((row, rowIndex) => {
          const first = row.seats[0];
          const second = row.seats[1];
          if (!first || !second) return null;
          // One seat-step further back along the row's own curve, so the
          // label sits where "the next seat to the left" would be.
          const labelX = first.x + (first.x - second.x);
          const labelY = first.y + (first.y - second.y);

          return (
            <text
              key={`row-label-${row.index}`}
              x={labelX}
              y={labelY}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#475569"
              fontSize={SEAT_SIZE * 0.6}
              fontWeight={700}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {rowLetter(rowIndex)}
            </text>
          );
        })}
    </>
  );
});

export default Seats;
