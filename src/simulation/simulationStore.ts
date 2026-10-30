import { create } from 'zustand';
import { DEFAULT_CONFIG, normalizeConfig, parseConfigFromSearch, type SimConfig } from './config';
import type { SimStats } from './engine';
import type { SimSpeed } from './protocol';

export type SimPhase = 'idle' | 'running' | 'paused' | 'finished';

export interface SimBatch {
  seatChanges: Uint32Array;
  soldOutSections: number[];
  stats: SimStats;
}

interface SimulationState {
  config: SimConfig;
  phase: SimPhase;
  speed: SimSpeed;
  heatmap: boolean;
  // Mutated in place for speed; `seatVersion` is what tells React something changed.
  seatStatus: Uint8Array | null;
  seatIndexById: ReadonlyMap<string, number> | null;
  sectionLabels: readonly string[];
  seatVersion: number;
  stats: SimStats | null;
  // Section index -> `performance.now()` when it sold out, for the brief highlight.
  soldOutAt: Readonly<Record<number, number>>;
  announcement: string;

  setConfig: (partial: Partial<SimConfig>) => void;
  setSpeed: (speed: SimSpeed) => void;
  setHeatmap: (on: boolean) => void;
  setPhase: (phase: SimPhase) => void;
  beginRun: (
    seatStatus: Uint8Array,
    seatIndexById: ReadonlyMap<string, number>,
    sectionLabels: readonly string[],
    stats: SimStats,
  ) => void;
  applyBatches: (batches: readonly SimBatch[], now: number) => void;
  clearRun: () => void;
}

const SEAT_STATUS_BITS = 2;
const SEAT_STATUS_MASK = 0b11;

function initialConfig(): SimConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  return parseConfigFromSearch(window.location.search);
}

function describeSaleEnd(stats: SimStats): string {
  return `Sale complete. ${stats.seats.sold} seats sold, ${stats.gaveUp} buyers gave up, ${stats.turnedAway} turned away.`;
}

export const useSimulationStore = create<SimulationState>()((set, get) => ({
  config: initialConfig(),
  phase: 'idle',
  speed: 10,
  heatmap: false,
  seatStatus: null,
  seatIndexById: null,
  sectionLabels: [],
  seatVersion: 0,
  stats: null,
  soldOutAt: {},
  announcement: '',

  setConfig: (partial) => {
    set((state) => ({ config: normalizeConfig({ ...state.config, ...partial }) }));
  },
  setSpeed: (speed) => {
    set({ speed });
  },
  setHeatmap: (heatmap) => {
    set({ heatmap });
  },
  setPhase: (phase) => {
    set({ phase });
  },

  beginRun: (seatStatus, seatIndexById, sectionLabels, stats) => {
    set((state) => ({
      seatStatus,
      seatIndexById,
      sectionLabels,
      stats,
      soldOutAt: {},
      announcement: 'Sale simulation started.',
      seatVersion: state.seatVersion + 1,
    }));
  },

  // Several batches can land between frames; they are merged here so the UI renders once.
  applyBatches: (batches, now) => {
    const { seatStatus, sectionLabels, soldOutAt: previousFlashes, stats: previous } = get();
    const last = batches[batches.length - 1];
    if (!seatStatus || !last) return;

    const soldOutAt: Record<number, number> = { ...previousFlashes };
    let announcement = '';
    for (const batch of batches) {
      for (const packed of batch.seatChanges) {
        seatStatus[packed >>> SEAT_STATUS_BITS] = packed & SEAT_STATUS_MASK;
      }
      for (const section of batch.soldOutSections) {
        soldOutAt[section] = now;
        announcement = `${sectionLabels[section] ?? `Section ${section + 1}`} has sold out.`;
      }
    }

    if ((previous?.soldOutAtMs ?? null) === null && last.stats.soldOutAtMs !== null) {
      announcement = 'All seats are now held or sold.';
    }
    const finished = last.stats.finished;
    if (finished) announcement = describeSaleEnd(last.stats);

    set((state) => ({
      stats: last.stats,
      soldOutAt,
      seatVersion: state.seatVersion + 1,
      ...(announcement && { announcement }),
      ...(finished && { phase: 'finished' as const }),
    }));
  },

  clearRun: () => {
    set((state) => ({
      phase: 'idle',
      seatStatus: null,
      seatIndexById: null,
      stats: null,
      soldOutAt: {},
      announcement: 'Sale simulation reset.',
      seatVersion: state.seatVersion + 1,
    }));
  },
}));
