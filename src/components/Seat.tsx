import { memo } from 'react';
import type { ISeat, Row } from '../interfaces/venue.interfaces';
import { useVenueStore } from '../store/seatStore';

interface SeatsProps {
  rows: Row[];
}

const Seats = memo(function Seats({ rows }: SeatsProps) {
  const selectedSeats = useVenueStore((s) => s.selectedSeats);
  const toggleSeat = useVenueStore((s) => s.toggleSeat);

  const handleInteraction = (
    e: React.MouseEvent | React.KeyboardEvent,
    seat: ISeat,
    isUnavailable: boolean,
  ) => {
    e.stopPropagation();
    if (!isUnavailable) {
      toggleSeat(seat.id);
      const target = e.currentTarget || document.getElementById(`seat-${seat.id}`);
      if (target && typeof (target as HTMLElement).focus === 'function') {
        (target as HTMLElement).focus();
      }
    }
  };

  const handleKeyDown = (
    e: React.KeyboardEvent,
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
          const isSelected = selectedSeats.has(seat.id);
          const isSold = seat.status === 'sold';
          const isReserved = seat.status === 'reserved';
          const isHeld = seat.status === 'held';
          const isUnavailable = isSold || isReserved || isHeld;

          let fill = 'white';
          let stroke = '#059669';

          const tierColors: Record<number, string> = {
            1: '#eab308',
            2: '#6b7280',
            3: '#f97316',
          };

          if (isSold) {
            fill = '#d1d5db';
            stroke = 'none';
          } else if (isReserved) {
            fill = '#fbbf24';
            stroke = 'none';
          } else if (isHeld) {
            fill = '#f87171';
            stroke = 'none';
          } else if (isSelected) {
            fill = '#10b981';
            stroke = 'none';
          } else {
            stroke = tierColors[seat.priceTier] || '#059669';
          }

          const label = `Row ${row.index} Seat ${seat.col}, Price $${seat.priceTier}, ${seat.status}`;

          return (
            <g
              key={seat.id}
              id={`seat-${seat.id}`}
              onClick={(e) => handleInteraction(e, seat, isUnavailable)}
              onKeyDown={(e) => handleKeyDown(e, seat, rowIndex, seatIndex, isUnavailable)}
              role="checkbox"
              aria-checked={isSelected}
              aria-label={label}
              aria-disabled={isUnavailable}
              tabIndex={isUnavailable ? -1 : 0}
              className="focus:outline-none group"
            >
              <rect
                x={seat.x - 1.2}
                y={seat.y - 0.9}
                width={2.4}
                height={1.8}
                rx={0.5}
                fill={fill}
                stroke={stroke}
                strokeWidth="0.3"
                className={
                  !isUnavailable ? 'group-focus:stroke-blue-600 group-focus:stroke-[1px]' : ''
                }
                style={{
                  cursor: isUnavailable ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  outline: 'none',
                }}
              />
            </g>
          );
        }),
      )}
    </>
  );
});

export default Seats;
