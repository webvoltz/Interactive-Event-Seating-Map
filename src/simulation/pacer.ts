import { TICK_MS, type SimulationEngine } from './engine';

// Longest slice of simulated time handed to the engine at once, so a pause lands within a moment.
const CHUNK_SIM_MS = 500;
// If the worker falls behind, drop the debt past this many wall-seconds rather than chase it forever.
const MAX_DEBT_WALL_MS = 1_000;

export interface PacerState {
  owedSimMs: number;
}

// Turns elapsed wall time into simulated time at `speed`. `wallNow` is injected so this
// stays testable; the engine itself never reads a clock.
export function pump(
  engine: SimulationEngine,
  state: PacerState,
  wallElapsedMs: number,
  speed: number,
  wallDeadline: () => boolean,
): void {
  state.owedSimMs = Math.min(state.owedSimMs + wallElapsedMs * speed, MAX_DEBT_WALL_MS * speed);
  while (state.owedSimMs >= TICK_MS && !engine.finished && !wallDeadline()) {
    const before = engine.simTimeMs;
    engine.advanceTo(before + Math.min(state.owedSimMs, CHUNK_SIM_MS));
    const advanced = engine.simTimeMs - before;
    if (advanced <= 0) break;
    state.owedSimMs -= advanced;
  }
}
