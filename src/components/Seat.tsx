import { memo, useMemo } from 'react';
import type { EffectiveSeatStatus, ISeat, Row } from '../interfaces/venue.interfaces';
import { useVenueStore } from '../store/seatStore';
import { rowLetter } from '../utils/rowLetter';
import { simStatusToEffective } from '../simulation/simStatus';
import { useSimulationStore } from '../simulation/simulationStore';
import { viewerGate } from '../simulation/viewerGate';
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

const SEAT_SIZE = 3;
const SEAT_RADIUS = 0.35;
const LABEL_ZOOM_THRESHOLD = 2;

interface SeatNodeProps {
  seat: ISeat;
  rows: Row[];
  rowIndex: number;
  seatIndex: number;
  status: EffectiveSeatStatus;
  isHighlighted: boolean;
  showLabels: boolean;
}

// One seat. Memoized so a live sale only re-renders the handful of seats whose status changed,
// not every seat in the open section on each batch.
const SeatNode = memo(function SeatNode({
  seat,
  rows,
  rowIndex,
  seatIndex,
  status,
  isHighlighted,
  showLabels,
}: SeatNodeProps) {
  const isSelected = status === 'selected';
  const isUnavailable = !isSeatSelectable(status);

  const style = SEAT_STATUS_STYLE[status];
  const { fill, textColor } = style;
  let { stroke, strokeWidth } = style;
  if (status === 'available') {
    stroke = TIER_STROKE[seat.priceTier] ?? stroke;
  }
  if (isHighlighted) {
    stroke = 'var(--color-booking-highlight)';
    strokeWidth = 0.5;
  }

  const label = `Row ${rowLetter(rowIndex)} Seat ${seat.col}, Price $${getTier(seat.priceTier).price}, ${describeSeatStatus(status)}`;

  const handleInteraction = (
    e: React.MouseEvent<SVGGElement> | React.KeyboardEvent<SVGGElement>,
  ) => {
    e.stopPropagation();
    // During a sale, only an admitted buyer can pick seats.
    const blocked = viewerGate();
    if (blocked !== null) {
      useVenueStore.getState().setFeedback({ type: 'error', message: blocked });
      return;
    }
    if (!isUnavailable) {
      useVenueStore.getState().toggleSeat(seat.id);
      e.currentTarget.focus();
    } else {
      useVenueStore
        .getState()
        .setFeedback({ type: 'error', message: 'That seat is no longer available.' });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleInteraction(e);
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
    <g
      id={`seat-${seat.id}`}
      onClick={handleInteraction}
      onKeyDown={handleKeyDown}
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
          !isUnavailable && 'group-focus/seat:stroke-blue-600 group-focus/seat:stroke-[0.5px]',
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
});

const Seats = memo(function Seats({ rows }: SeatsProps) {
  const selectedSeats = useVenueStore((s) => s.selectedSeats);
  const soldSeats = useVenueStore((s) => s.soldSeats);
  const holds = useVenueStore((s) => s.holds);
  const simulationSeeded = useVenueStore((s) => s.simulationSeeded);
  const bookings = useVenueStore((s) => s.bookings);
  const viewingBookingId = useVenueStore((s) => s.viewingBookingId);
  const showLabels = useVenueStore((s) => s.zoom >= LABEL_ZOOM_THRESHOLD);
  const simStatus = useSimulationStore((s) => s.seatStatus);
  const simIndex = useSimulationStore((s) => s.seatIndexById);
  // Only an admitted buyer on the live board has picks of their own on it.
  const ownsPicks = useSimulationStore(
    (s) => s.viewer.stage === 'admitted' && s.replayAtMs === null,
  );
  // Re-renders on every merged batch; the status array itself is mutated in place.
  useSimulationStore((s) => s.seatVersion);
  const now = Date.now();

  const highlightedSeatIds = useMemo(() => {
    if (!viewingBookingId) return null;
    const booking = bookings.find((b) => b.id === viewingBookingId);
    return booking ? new Set(booking.seatIds) : null;
  }, [bookings, viewingBookingId]);

  return (
    <>
      {rows.map((row, rowIndex) =>
        row.seats.map((seat, seatIndex) => {
          const simCode =
            simStatus && simIndex ? simStatus[simIndex.get(seat.id) ?? -1] : undefined;
          let status =
            simCode === undefined
              ? resolveSeatStatus(seat, { soldSeats, holds, selectedSeats, now, simulationSeeded })
              : simStatusToEffective(simCode);
          if (
            simCode !== undefined &&
            ownsPicks &&
            (status === 'available' || status === 'held') &&
            selectedSeats.has(seat.id)
          ) {
            status = 'selected';
          }

          return (
            <SeatNode
              key={seat.id}
              seat={seat}
              rows={rows}
              rowIndex={rowIndex}
              seatIndex={seatIndex}
              status={status}
              isHighlighted={highlightedSeatIds?.has(seat.id) ?? false}
              showLabels={showLabels}
            />
          );
        }),
      )}
      {showLabels &&
        rows.map((row, rowIndex) => {
          const first = row.seats[0];
          const second = row.seats[1];
          if (!first || !second) return null;
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
