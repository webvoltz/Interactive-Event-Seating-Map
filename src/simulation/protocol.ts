import type { Venue } from '../interfaces/venue.interfaces';
import type { SimConfig } from './config';
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
  | { type: 'viewerJoin' }
  | { type: 'viewerLeave' }
  | { type: 'viewerHold'; seats: number[] }
  | { type: 'viewerRelease'; seats: number[] }
  | { type: 'viewerBuy'; seats: number[] };

export type WorkerEvent =
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
