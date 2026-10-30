import { memo, useMemo, useEffect } from 'react';
import { useVenueStore } from '../store/seatStore';
import type { Section } from '../interfaces/venue.interfaces';
import type { VenueContentBounds } from '../utils/venueBounds';
import { computeFitZoom, SECTION_FOCUS_TRANSITION_MS } from '../utils/viewTransform';
import { getSectionGeometry } from '../utils/sectionGeometry';
import Seats from './Seat';

const FOCUS_PADDING = 60;

function Section({ section, bounds }: { section: Section; bounds: VenueContentBounds }) {
  const activeSectionId = useVenueStore((s) => s.activeSectionId);
  const setActiveSection = useVenueStore((s) => s.setActiveSection);
  const mapFocusSeatIds = useVenueStore((s) => s.mapFocusSeatIds);

  const isActive = activeSectionId === section.id;

  const focusSeatIds = useMemo(() => {
    return mapFocusSeatIds ? new Set(mapFocusSeatIds) : null;
  }, [mapFocusSeatIds]);

  const { labelPos, explodeOffset, coverPath } = useMemo(
    () => getSectionGeometry(section),
    [section],
  );

  useEffect(() => {
    if (!isActive) return;

    const focusSeats = focusSeatIds
      ? section.rows.flatMap((row) => row.seats.filter((seat) => focusSeatIds.has(seat.id)))
      : [];
    const seatsForBounds =
      focusSeats.length > 0 ? focusSeats : section.rows.flatMap((r) => r.seats);

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    seatsForBounds.forEach((seat) => {
      minX = Math.min(minX, seat.x);
      minY = Math.min(minY, seat.y);
      maxX = Math.max(maxX, seat.x);
      maxY = Math.max(maxY, seat.y);
    });

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const mapContainer = document.getElementById('map-viewport');
    if (!mapContainer) return;

    const focusZoom = computeFitZoom(
      {
        minX: 0,
        minY: 0,
        width: maxX - minX + FOCUS_PADDING * 2,
        height: maxY - minY + FOCUS_PADDING * 2,
      },
      mapContainer.clientWidth - 64,
      mapContainer.clientHeight - 64,
    );

    useVenueStore.getState().setView(
      focusZoom,
      {
        x: mapContainer.clientWidth / 2 - (centerX + explodeOffset.x - bounds.minX) * focusZoom,
        y: mapContainer.clientHeight / 2 - (centerY + explodeOffset.y - bounds.minY) * focusZoom,
      },
      SECTION_FOCUS_TRANSITION_MS,
    );
  }, [isActive, section, bounds, explodeOffset, focusSeatIds]);

  const toggleActive = () => {
    setActiveSection(isActive ? null : section.id);
  };

  return (
    <g
      onClick={(e) => {
        e.stopPropagation();
        toggleActive();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          toggleActive();
        }
      }}
      role="button"
      tabIndex={0}
      aria-expanded={isActive}
      aria-label={`Section ${section.label}${isActive ? ', expanded' : ''}`}
      style={{ cursor: 'pointer' }}
      className="group/section focus:outline-none"
      transform={`translate(${explodeOffset.x} ${explodeOffset.y})`}
    >
      {isActive ? (
        <g key="active" className="section-activate">
          <path
            d={coverPath}
            fill="white"
            fillOpacity="0.01"
            stroke="none"
            onClick={(e) => {
              e.stopPropagation();
            }}
            style={{ cursor: 'default' }}
          />
          <Seats rows={section.rows} />
        </g>
      ) : (
        <g key="collapsed" className="section-activate hover:opacity-80 transition-opacity">
          <path
            d={coverPath}
            fill="#e2e8f0"
            strokeWidth={25}
            strokeLinejoin="round"
            className="drop-shadow-sm"
          />
          <path
            d={coverPath}
            fill="none"
            stroke="#94a3b8"
            strokeLinejoin="round"
            className="group-focus/section:stroke-blue-600 group-focus/section:stroke-[6px]"
          />

          <text
            x={labelPos.x}
            y={labelPos.y - 5}
            textAnchor="middle"
            fontSize="32"
            fontWeight="800"
            className="fill-slate-700"
            style={{ pointerEvents: 'none' }}
          >
            {section.label}
          </text>
        </g>
      )}
    </g>
  );
}

export default memo(Section);
