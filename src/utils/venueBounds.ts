import type { Venue } from '../interfaces/venue.interfaces';

// Room for the section explode offset, strokes, and labels beyond the
// seats' own bounding box.
export const VENUE_CONTENT_PADDING = 120;

export interface VenueContentBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

// The venue's actual rendered content extent (the seats' real bounding box,
// plus padding) - not the full map canvas (venue.map.width/height), which is
// deliberately padded with generous built-in margin for panning room and the
// section "explode" offset. Shared by VenueMap.tsx (to size/crop the SVG to
// what's actually drawn, instead of the whole oversized canvas) and App.tsx
// (to compute a zoom that fills the viewport with that content) so the two
// can't drift out of sync with each other.
export function getVenueContentBounds(venue: Venue): VenueContentBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  venue.sections.forEach((section) => {
    section.rows.forEach((row) => {
      row.seats.forEach((seat) => {
        minX = Math.min(minX, seat.x);
        maxX = Math.max(maxX, seat.x);
        minY = Math.min(minY, seat.y);
        maxY = Math.max(maxY, seat.y);
      });
    });
  });
  return {
    minX: minX - VENUE_CONTENT_PADDING,
    minY: minY - VENUE_CONTENT_PADDING,
    width: maxX - minX + VENUE_CONTENT_PADDING * 2,
    height: maxY - minY + VENUE_CONTENT_PADDING * 2,
  };
}
