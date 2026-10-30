import type { Venue } from '../interfaces/venue.interfaces';
import type { SimConfig } from './config';
import type { SimStats } from './engine';

export const SPEEDS = [1, 10, 100] as const;
export type SimSpeed = (typeof SPEEDS)[number];

export type WorkerCommand =
  | { type: 'init'; venue: Venue; config: SimConfig }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'speed'; speed: SimSpeed }
  | { type: 'reset'; config: SimConfig };

export type WorkerEvent =
  // A fresh engine is built; `seatStatus` is its starting board, one byte per seat.
  | { type: 'ready'; seatStatus: Uint8Array; stats: SimStats }
  | {
      type: 'batch';
      // Packed (seatIndex << 2) | status.
      seatChanges: Uint32Array;
      soldOutSections: number[];
      stats: SimStats;
    };
