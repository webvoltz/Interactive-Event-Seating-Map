import { create } from 'zustand';
import { DEFAULT_CONFIG, normalizeConfig, parseConfigFromSearch, type SimConfig } from './config';
import type { SimSample, SimStats, ViewerState } from './engine';
import { TICK_MS } from './engine';
import type { DetectionComparison } from './comparison';
import { EventLog } from './eventLog';
import type { SimSpeed } from './protocol';

export type SimPhase = 'idle' | 'running' | 'paused' | 'finished';

// The scalper-bot before/after run: two full sales, played in a worker of their own.
export type ComparisonState =
  | { status: 'idle' }
  | { status: 'running'; finished: 0 | 1 | 2 }
  | { status: 'done'; result: DetectionComparison };

export interface SimBatch {
  seatChanges: Uint32Array;
  changeTicks: Uint32Array;
  viewer: ViewerState;
  soldOutSections: number[];
  samples: SimSample[];
  stats: SimStats;
}

interface SimulationState {
  config: SimConfig;
  phase: SimPhase;
  speed: SimSpeed;
  heatmap: boolean;
  // What the map shows. Mutated in place for speed; `seatVersion` is what tells React something changed.
  // It is the live board, except while a past moment is being replayed.
  seatStatus: Uint8Array | null;
  liveStatus: Uint8Array | null;
  initialBoard: Uint8Array | null;
  log: EventLog | null;
  // null = following the live sale; otherwise the simulated time being viewed.
  replayAtMs: number | null;
  viewer: ViewerState;
  seatIndexById: ReadonlyMap<string, number> | null;
  sectionLabels: readonly string[];
  seatVersion: number;
  stats: SimStats | null;
  series: readonly SimSample[];
  summaryDismissed: boolean;
  // Section index -> `performance.now()` when it sold out, for the brief highlight.
  soldOutAt: Readonly<Record<number, number>>;
  announcement: string;
  comparison: ComparisonState;

  setComparison: (comparison: ComparisonState) => void;
  setConfig: (partial: Partial<SimConfig>) => void;
  setSpeed: (speed: SimSpeed) => void;
  setHeatmap: (on: boolean) => void;
  setPhase: (phase: SimPhase) => void;
  beginRun: (
    seatStatus: Uint8Array,
    seatIndexById: ReadonlyMap<string, number>,
    sectionLabels: readonly string[],
    stats: SimStats,
    viewer?: ViewerState,
  ) => void;
  setReplayAt: (ms: number | null) => void;
  applyBatches: (batches: readonly SimBatch[], now: number) => void;
  dismissSummary: () => void;
  clearRun: () => void;
}

// Announced once each as the sale passes them, so a screen reader hears progress, not a firehose.
const SOLD_MILESTONES = [25, 50, 75, 90];

export const NO_VIEWER: ViewerState = {
  stage: 'none',
  position: null,
  etaMs: null,
  seats: [],
  seatsBought: 0,
};

// The latest sample taken at or before `ms`, i.e. the stats as they stood then.
export function snapshotAtOrBefore(series: readonly SimSample[], ms: number): SimStats | null {
  let low = 0;
  let high = series.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((series[mid]?.t ?? 0) <= ms) low = mid + 1;
    else high = mid;
  }
  return series[low - 1]?.snapshot ?? null;
}

// What the panels should show: the live numbers, or the snapshot for the replayed moment.
export function selectDisplayStats(state: {
  stats: SimStats | null;
  series: readonly SimSample[];
  replayAtMs: number | null;
}): SimStats | null {
  if (state.replayAtMs === null) return state.stats;
  return snapshotAtOrBefore(state.series, state.replayAtMs) ?? state.stats;
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
  liveStatus: null,
  initialBoard: null,
  log: null,
  replayAtMs: null,
  viewer: NO_VIEWER,
  seatIndexById: null,
  sectionLabels: [],
  seatVersion: 0,
  stats: null,
  series: [],
  summaryDismissed: false,
  soldOutAt: {},
  announcement: '',
  comparison: { status: 'idle' },

  setComparison: (comparison) => {
    set({
      comparison,
      // A finished comparison is worth saying out loud; a progress tick is not.
      ...(comparison.status === 'done' && {
        announcement: `Scalper bot comparison ready: real fans got ${comparison.result.off.fanShare.toFixed(0)} percent of the best seats without detection and ${comparison.result.on.fanShare.toFixed(0)} percent with it.`,
      }),
    });
  },
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

  beginRun: (seatStatus, seatIndexById, sectionLabels, stats, viewer = NO_VIEWER) => {
    set((state) => ({
      seatStatus,
      liveStatus: seatStatus,
      initialBoard: seatStatus.slice(),
      log: new EventLog(),
      replayAtMs: null,
      viewer,
      seatIndexById,
      sectionLabels,
      stats,
      series: [],
      summaryDismissed: false,
      soldOutAt: {},
      announcement: 'Sale simulation started.',
      seatVersion: state.seatVersion + 1,
    }));
  },

  // Several batches can land between frames; they are merged here so the UI renders once.
  applyBatches: (batches, now) => {
    const {
      liveStatus: seatStatus,
      log,
      sectionLabels,
      soldOutAt: previousFlashes,
      stats: previous,
      viewer: previousViewer,
    } = get();
    const last = batches[batches.length - 1];
    if (!seatStatus || !last) return;

    const soldOutAt: Record<number, number> = { ...previousFlashes };
    const series = batches.flatMap((batch) => batch.samples);
    let announcement = '';
    const crossed = SOLD_MILESTONES.filter(
      (m) => (previous?.soldPct ?? 0) < m && last.stats.soldPct >= m,
    ).pop();
    if (crossed !== undefined) announcement = `${crossed} percent of seats sold.`;
    for (const batch of batches) {
      log?.append(batch.changeTicks, batch.seatChanges);
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
    if (previousViewer.stage !== last.viewer.stage) {
      if (last.viewer.stage === 'admitted') {
        announcement = 'It is your turn. Pick your seats before the checkout timer runs out.';
      } else if (last.viewer.stage === 'turned-away') {
        announcement = 'The sale ended before your turn.';
      }
    }
    const finished = last.stats.finished;
    if (finished) announcement = describeSaleEnd(last.stats);

    set((state) => ({
      stats: last.stats,
      viewer: last.viewer,
      series: series.length > 0 ? [...state.series, ...series] : state.series,
      soldOutAt,
      seatVersion: state.seatVersion + 1,
      ...(announcement && { announcement }),
      ...(finished && { phase: 'finished' as const }),
    }));
  },

  // Rebuilds the board at `ms` from the event log; null (or the present) goes back to the live board.
  setReplayAt: (ms) => {
    const { liveStatus, initialBoard, log, stats } = get();
    if (!liveStatus || !initialBoard || !log || !stats) return;
    if (ms === null || ms >= stats.simTimeMs) {
      set((state) => ({
        replayAtMs: null,
        seatStatus: liveStatus,
        seatVersion: state.seatVersion + 1,
      }));
      return;
    }
    const at = Math.max(0, ms);
    set((state) => ({
      replayAtMs: at,
      seatStatus: log.boardAt(initialBoard, Math.floor(at / TICK_MS)),
      seatVersion: state.seatVersion + 1,
    }));
  },

  dismissSummary: () => {
    set({ summaryDismissed: true });
  },

  clearRun: () => {
    set((state) => ({
      phase: 'idle',
      seatStatus: null,
      liveStatus: null,
      initialBoard: null,
      log: null,
      replayAtMs: null,
      viewer: NO_VIEWER,
      seatIndexById: null,
      stats: null,
      series: [],
      summaryDismissed: false,
      soldOutAt: {},
      announcement: 'Sale simulation reset.',
      seatVersion: state.seatVersion + 1,
    }));
  },
}));
