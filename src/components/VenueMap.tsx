import { useMemo } from 'react';
import type { Venue } from '../interfaces/venue.interfaces';
import Section from './Section';
import { useVenueStore } from '../store/seatStore';
import { getVenueContentBounds } from '../utils/venueBounds';

interface VenueMapProps {
  venue: Venue;
  zoom?: number;
  pan?: { x: number; y: number };
  smooth?: boolean;
}

export default function VenueMap({
  venue,
  zoom = 1,
  pan = { x: 0, y: 0 },
  smooth = false,
}: VenueMapProps) {
  // Size/crop the SVG to the venue's actual content extent, not the full map
  // canvas - see getVenueContentBounds for why. Sections' own seat
  // coordinates are unaffected (they're absolute, in the same coordinate
  // space); only what portion of that space the viewBox exposes changes.
  const bounds = useMemo(() => getVenueContentBounds(venue), [venue]);

  return (
    <div
      className="absolute top-0 left-0 shrink-0"
      style={{
        width: bounds.width,
        height: bounds.height,
        transformOrigin: '0 0',
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transition: smooth ? 'transform 200ms ease-out' : 'none',
      }}
    >
      <svg
        width={bounds.width}
        height={bounds.height}
        viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
        onClick={() => {
          useVenueStore.getState().setActiveSection(null);
        }}
      >
        <g transform={`translate(${venue.map.width / 2}, ${venue.map.height / 2})`}>
          <rect
            x="-180"
            y="-180"
            width="360"
            height="360"
            fill="#1e293b"
            stroke="#475569"
            strokeWidth="4"
            rx="4"
            className="shadow-2xl"
          />
          <rect
            x="-160"
            y="-160"
            width="320"
            height="320"
            fill="none"
            stroke="#334155"
            strokeWidth="2"
            strokeDasharray="10 5"
            rx="2"
          />

          <text
            y="5"
            textAnchor="middle"
            fill="#e2e8f0"
            fontSize="34"
            fontWeight="800"
            letterSpacing="0.2em"
          >
            STAGE
          </text>
        </g>

        {venue.sections.map((section) => (
          <Section key={section.id} section={section} bounds={bounds} />
        ))}
      </svg>
    </div>
  );
}
