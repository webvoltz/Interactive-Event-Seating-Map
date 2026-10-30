import { MAX_SELECTABLE_SEATS } from '../utils/selectionLimits';
import { SELECTION_HOLD_MS } from '../utils/holdProtocol';

export const ARRIVAL_PATTERNS = ['spike', 'steady', 'waves'] as const;
export type ArrivalPattern = (typeof ARRIVAL_PATTERNS)[number];

export interface SimConfig {
  buyers: number;
  pattern: ArrivalPattern;
  // Buyers let in from the waiting room per second.
  admitPerSec: number;
  holdMs: number;
  seed: number;
}

export const BUYERS_MIN = 1_000;
export const BUYERS_MAX = 20_000;
export const ADMIT_MIN = 10;
export const ADMIT_MAX = 5_000;
export const HOLD_MIN_MS = 10_000;
export const HOLD_MAX_MS = 15 * 60_000;
export const MAX_GROUP_SIZE = MAX_SELECTABLE_SEATS;

export const DEFAULT_CONFIG: SimConfig = {
  buyers: BUYERS_MAX,
  pattern: 'spike',
  admitPerSec: 400,
  holdMs: SELECTION_HOLD_MS,
  seed: 20261030,
};

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function parseNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function isPattern(value: string | null): value is ArrivalPattern {
  return ARRIVAL_PATTERNS.some((p) => p === value);
}

export function normalizeConfig(partial: Partial<SimConfig>): SimConfig {
  const merged = { ...DEFAULT_CONFIG, ...partial };
  return {
    buyers: clampInt(merged.buyers, BUYERS_MIN, BUYERS_MAX),
    pattern: isPattern(merged.pattern) ? merged.pattern : DEFAULT_CONFIG.pattern,
    admitPerSec: clampInt(merged.admitPerSec, ADMIT_MIN, ADMIT_MAX),
    holdMs: clampInt(merged.holdMs, HOLD_MIN_MS, HOLD_MAX_MS),
    seed: Math.round(merged.seed) >>> 0,
  };
}

// Unknown, missing or out-of-range params fall back to defaults rather than throwing: URLs get hand-edited.
export function parseConfigFromSearch(search: string): SimConfig {
  const params = new URLSearchParams(search);
  const partial: Partial<SimConfig> = {};

  const buyers = parseNumber(params.get('buyers'));
  if (buyers !== null) partial.buyers = buyers;
  const pattern = params.get('pattern');
  if (isPattern(pattern)) partial.pattern = pattern;
  const admit = parseNumber(params.get('admit'));
  if (admit !== null) partial.admitPerSec = admit;
  const holdSec = parseNumber(params.get('hold'));
  if (holdSec !== null) partial.holdMs = holdSec * 1000;
  const seed = parseNumber(params.get('seed'));
  if (seed !== null) partial.seed = seed;

  return normalizeConfig(partial);
}

export function serializeConfig(config: SimConfig): string {
  const params = new URLSearchParams({
    buyers: String(config.buyers),
    pattern: config.pattern,
    admit: String(config.admitPerSec),
    hold: String(Math.round(config.holdMs / 1000)),
    seed: String(config.seed),
  });
  return params.toString();
}
