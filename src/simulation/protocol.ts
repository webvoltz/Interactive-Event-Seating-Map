import type { Venue } from '../interfaces/venue.interfaces';
import type { SimConfig } from './config';
import type { DetectionComparison } from './comparison';
import type { SimSample, SimStats, ViewerState } from './engine';

export const SPEEDS = [1, 10, 100] as const;
export type SimSpeed = (typeof SPEEDS)[number];

export type WorkerCommand =
  | { type: 'init'; venue: Venue; config: SimConfig }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'speed'; speed: SimSpeed }
  | { type: 'reset'; config: SimConfig }
  // Plays the same seeded sale twice (detector off, then on) and reports both. Meant for a worker of its own.
  | { type: 'compare'; venue: Venue; config: SimConfig }
  | { type: 'viewerJoin' }
  | { type: 'viewerLeave' }
  | { type: 'viewerHold'; seats: number[] }
  | { type: 'viewerRelease'; seats: number[] }
  | { type: 'viewerBuy'; seats: number[] };

export type WorkerEvent =
  | { type: 'comparisonProgress'; finished: 0 | 1 | 2 }
  | { type: 'comparison'; result: DetectionComparison }
  // A fresh engine is built; `seatStatus` is its starting board, one byte per seat.
  | { type: 'ready'; seatStatus: Uint8Array; stats: SimStats; viewer: ViewerState }
  | {
      type: 'batch';
      // Packed (seatIndex << 2) | status.
      seatChanges: Uint32Array;
      // The tick each of `seatChanges` happened on, for replay.
      changeTicks: Uint32Array;
      soldOutSections: number[];
      // History points recorded since the previous batch.
      samples: SimSample[];
      stats: SimStats;
      viewer: ViewerState;
      // Seats the viewer asked to hold that someone else got first.
      viewerRejected: number[];
    };
