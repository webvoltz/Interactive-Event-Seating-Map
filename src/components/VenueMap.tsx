import type { Venue } from '../interfaces/venue.interfaces';
import Section from './Section';
import { useVenueStore } from '../store/seatStore';

export default function VenueMap({ venue, zoom = 1 }: { venue: Venue; zoom?: number }) {
  return (
    <svg
      width={venue.map.width * zoom}
      height={venue.map.height * zoom}
      viewBox={`0 0 ${venue.map.width} ${venue.map.height}`}
      onClick={() => {
        useVenueStore.getState().setActiveSection(null);
      }}
    >
      <g transform={`translate(${venue.map.width / 2}, ${venue.map.height / 2})`}>
        <rect
          x="-150"
          y="-100"
          width="300"
          height="200"
          fill="#1e293b"
          stroke="#475569"
          strokeWidth="4"
          rx="4"
          className="shadow-2xl"
        />
        <rect
          x="-130"
          y="-80"
          width="260"
          height="160"
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
          fontSize="24"
          fontWeight="800"
          letterSpacing="0.2em"
        >
          STAGE
        </text>
      </g>

      {venue.sections.map((section) => (
        <Section key={section.id} section={section} />
      ))}
    </svg>
  );
}
