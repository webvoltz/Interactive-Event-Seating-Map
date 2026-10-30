import type { Venue } from '../interfaces/venue.interfaces';
import type { SimConfig } from './config';
import { SimulationEngine, type SimStats } from './engine';
import type { RuleName } from './detection';

// Run in chunks so a long sale never holds the thread for one giant step.
const CHUNK_SIM_MS = 60_000;
const SAFETY_CAP_SIM_MS = 3 * 60 * 60_000;

// One finished sale, reduced to what the before/after view needs.
export interface DetectionOutcome {
  detection: boolean;
  // Percentage of the best seats sold that went to real buyers.
  fanShare: number;
  bestSeatsTotal: number;
  bestToFans: number;
  bestToBots: number;
  botsTotal: number;
  botsBlocked: number;
  // Real buyers the detector blocked by mistake.
  humansBlocked: number;
  botSeatsSold: number;
  botRevenue: number;
  revenue: number;
  soldOutAtMs: number | null;
  simTimeMs: number;
  blockedBy: Record<RuleName, number>;
}

export interface DetectionComparison {
  off: DetectionOutcome;
  on: DetectionOutcome;
}

export function outcomeOf(stats: SimStats): DetectionOutcome {
  const { bots } = stats;
  return {
    detection: bots.detection,
    fanShare: bots.fanShare,
    bestSeatsTotal: bots.bestSeats.total,
    bestToFans: bots.bestSeats.soldToFans,
    bestToBots: bots.bestSeats.soldToBots,
    botsTotal: bots.identities,
    botsBlocked: bots.blocked,
    humansBlocked: bots.humansBlocked,
    botSeatsSold: bots.seatsSold,
    botRevenue: bots.revenue,
    revenue: stats.revenue,
    soldOutAtMs: stats.soldOutAtMs,
    simTimeMs: stats.simTimeMs,
    blockedBy: bots.blockedBy,
  };
}

export function runSale(venue: Venue, config: SimConfig): DetectionOutcome {
  const engine = new SimulationEngine(venue, config);
  for (let t = CHUNK_SIM_MS; !engine.finished && t <= SAFETY_CAP_SIM_MS; t += CHUNK_SIM_MS) {
    engine.advanceTo(t);
  }
  return outcomeOf(engine.getStats());
}

// The identical seeded sale, played twice: once with the detector off, once with it on. Same crowd,
// same bots, same seed, so any difference is down to detection alone.
export function compareDetection(
  venue: Venue,
  config: SimConfig,
  onProgress: (finished: 0 | 1 | 2) => void = () => undefined,
): DetectionComparison {
  onProgress(0);
  const off = runSale(venue, { ...config, detection: false });
  onProgress(1);
  const on = runSale(venue, { ...config, detection: true });
  onProgress(2);
  return { off, on };
}
