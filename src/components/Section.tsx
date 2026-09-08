import { memo, useMemo, useEffect } from 'react';
import { useVenueStore } from '../store/seatStore';
import type { Section } from '../interfaces/venue.interfaces';
import type { VenueContentBounds } from '../utils/venueBounds';
import Seats from './Seat';

function Section({ section, bounds }: { section: Section; bounds: VenueContentBounds }) {
  const activeSectionId = useVenueStore((s) => s.activeSectionId);
  const setZoom = useVenueStore((s) => s.setZoom);
  const setActiveSection = useVenueStore((s) => s.setActiveSection);

  const isActive = activeSectionId === section.id;

  useEffect(() => {
    if (isActive) {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      section.rows.forEach((row) => {
        row.seats.forEach((seat) => {
          minX = Math.min(minX, seat.x);
          minY = Math.min(minY, seat.y);
          maxX = Math.max(maxX, seat.x);
          maxY = Math.max(maxY, seat.y);
        });
      });

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const timer = setTimeout(() => {
        const mapContainer = document.querySelector('main.overflow-auto');
        if (mapContainer) {
          const currentZoom = useVenueStore.getState().zoom;
          // The SVG's own pixel origin is the viewBox's top-left corner
          // (bounds.minX/minY, cropped to the venue's content - see
          // VenueMap.tsx), not absolute coordinate (0, 0), so that offset
          // has to be subtracted before scaling by zoom.
          const scrollX = (centerX - bounds.minX) * currentZoom - mapContainer.clientWidth / 2;
          const scrollY = (centerY - bounds.minY) * currentZoom - mapContainer.clientHeight / 2;

          mapContainer.scrollTo({
            left: Math.max(0, scrollX),
            top: Math.max(0, scrollY),
            behavior: 'smooth',
          });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isActive, section, bounds]);

  const coverPath = useMemo(() => {
    const firstRow = section.rows[0];
    const lastRow = section.rows[section.rows.length - 1];
    const firstSeat = firstRow?.seats[0];
    if (!firstRow || !lastRow || !firstSeat) return '';

    let d = `M ${firstSeat.x} ${firstSeat.y}`;

    for (let i = 1; i < firstRow.seats.length; i++) {
      const s = firstRow.seats[i];
      if (s) d += ` L ${s.x} ${s.y}`;
    }

    for (let i = lastRow.seats.length - 1; i >= 0; i--) {
      const s = lastRow.seats[i];
      if (s) d += ` L ${s.x} ${s.y}`;
    }

    d += ' Z';
    return d;
  }, [section]);

  const { labelPos, explodeOffset } = useMemo(() => {
    const emptyResult = { labelPos: { x: 0, y: 0 }, explodeOffset: { x: 0, y: 0 } };

    const firstRow = section.rows[0];
    const lastRow = section.rows[section.rows.length - 1];
    if (!firstRow || !lastRow) return emptyResult;

    const firstRowMid = firstRow.seats[Math.floor(firstRow.seats.length / 2)];
    const lastRowMid = lastRow.seats[Math.floor(lastRow.seats.length / 2)];
    if (!firstRowMid || !lastRowMid) return emptyResult;

    const centerX = (firstRowMid.x + lastRowMid.x) / 2;
    const centerY = (firstRowMid.y + lastRowMid.y) / 2;
    const labelPosition = { x: centerX, y: centerY };

    const venueCenterX = 1200;
    const venueCenterY = 1200;
    const dx = centerX - venueCenterX;
    const dy = centerY - venueCenterY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const gap = 40;
    let offX = 0;
    let offY = 0;

    if (dist > 0) {
      offX = (dx / dist) * gap;
      offY = (dy / dist) * gap;
    }

    return {
      labelPos: labelPosition,
      explodeOffset: { x: offX, y: offY },
    };
  }, [section]);

  const toggleActive = () => {
    const newActiveId = isActive ? null : section.id;
    setActiveSection(newActiveId);
    if (newActiveId) setZoom(8);
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
            onClick={(e) => e.stopPropagation()}
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
            className="text-sm font-bold fill-slate-700"
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
