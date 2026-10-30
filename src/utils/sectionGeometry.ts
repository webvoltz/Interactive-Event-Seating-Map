import type { Section } from '../interfaces/venue.interfaces';

export interface SectionGeometry {
  labelPos: { x: number; y: number };
  // How far a section drifts outward from the venue centre, so neighbours don't touch.
  explodeOffset: { x: number; y: number };
  // Outline running along the first row and back along the last.
  coverPath: string;
}

const VENUE_CENTER = 1200;
const EXPLODE_GAP = 40;

// Shared by the SVG section and the canvas heatmap so the two can never drift apart.
export function getSectionGeometry(section: Section): SectionGeometry {
  const firstRow = section.rows[0];
  const lastRow = section.rows[section.rows.length - 1];
  const empty: SectionGeometry = {
    labelPos: { x: 0, y: 0 },
    explodeOffset: { x: 0, y: 0 },
    coverPath: '',
  };
  if (!firstRow || !lastRow) return empty;

  const firstSeat = firstRow.seats[0];
  const firstRowMid = firstRow.seats[Math.floor(firstRow.seats.length / 2)];
  const lastRowMid = lastRow.seats[Math.floor(lastRow.seats.length / 2)];
  if (!firstRowMid || !lastRowMid) return empty;

  const centerX = (firstRowMid.x + lastRowMid.x) / 2;
  const centerY = (firstRowMid.y + lastRowMid.y) / 2;
  const dx = centerX - VENUE_CENTER;
  const dy = centerY - VENUE_CENTER;
  const dist = Math.sqrt(dx * dx + dy * dy);

  let coverPath = '';
  if (firstSeat) {
    coverPath = `M ${firstSeat.x} ${firstSeat.y}`;
    for (let i = 1; i < firstRow.seats.length; i++) {
      const s = firstRow.seats[i];
      if (s) coverPath += ` L ${s.x} ${s.y}`;
    }
    for (let i = lastRow.seats.length - 1; i >= 0; i--) {
      const s = lastRow.seats[i];
      if (s) coverPath += ` L ${s.x} ${s.y}`;
    }
    coverPath += ' Z';
  }

  return {
    labelPos: { x: centerX, y: centerY },
    explodeOffset:
      dist > 0 ? { x: (dx / dist) * EXPLODE_GAP, y: (dy / dist) * EXPLODE_GAP } : { x: 0, y: 0 },
    coverPath,
  };
}
