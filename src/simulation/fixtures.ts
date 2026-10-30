import type { ISeat, Venue } from '../interfaces/venue.interfaces';
import type { SeatStatus } from '../interfaces/venue.interfaces';
import { DEFAULT_CONFIG, type SimConfig } from './config';

interface RowSpec {
  // One character per seat: '.' available, 's' sold, 'r' reserved, 'h' pre-sale held.
  seats: string;
  tier?: number;
}

const STATUS_BY_CHAR: Record<string, SeatStatus> = {
  '.': 'available',
  s: 'sold',
  r: 'reserved',
  h: 'held',
};

// Builds a tiny venue from row sketches so tests can reason about every seat by hand.
export function makeVenue(sections: RowSpec[][]): Venue {
  let seatNo = 0;
  return {
    venueId: 'test',
    name: 'Test venue',
    map: { width: 100, height: 100 },
    sections: sections.map((rows, sectionIndex) => ({
      id: `S-${sectionIndex + 1}`,
      label: `Section ${sectionIndex + 1}`,
      transform: { x: 0, y: 0, scale: 1 },
      rows: rows.map((row, rowIndex) => ({
        index: rowIndex + 1,
        seats: Array.from(row.seats).map((char, col): ISeat => {
          seatNo += 1;
          return {
            id: `T-${seatNo}`,
            col: col + 1,
            x: col * 10,
            y: rowIndex * 10 + sectionIndex * 100,
            priceTier: row.tier ?? 3,
            status: STATUS_BY_CHAR[char] ?? 'available',
          };
        }),
      })),
    })),
  };
}

export function makeConfig(partial: Partial<SimConfig> = {}): SimConfig {
  return { ...DEFAULT_CONFIG, ...partial };
}
