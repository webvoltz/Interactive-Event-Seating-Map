import { useState } from 'react';
import type { Venue } from '../interfaces/venue.interfaces';
import {
  ADMIT_MAX,
  ADMIT_MIN,
  ARRIVAL_PATTERNS,
  BUYERS_MAX,
  BUYERS_MIN,
  HOLD_MAX_MS,
  HOLD_MIN_MS,
  type ArrivalPattern,
} from '../simulation/config';
import { SPEEDS } from '../simulation/protocol';
import {
  pauseSale,
  resetSale,
  resumeSale,
  setSaleSpeed,
  startSale,
  syncUrl,
} from '../simulation/simulationController';
import { useSimulationStore } from '../simulation/simulationStore';

const PATTERN_LABELS: Record<ArrivalPattern, string> = {
  spike: 'Sudden spike',
  steady: 'Steady',
  waves: 'Waves',
};

const buttonClass =
  'cursor-pointer rounded-lg px-3 py-1.5 text-sm font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButton = `${buttonClass} bg-emerald-700 border-emerald-800 text-white hover:bg-emerald-800`;
const plainButton = `${buttonClass} bg-white border-gray-300 text-gray-800 hover:bg-gray-50`;
const fieldClass =
  'w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:bg-gray-100 disabled:text-gray-500';

interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}

// Keeps what is being typed locally and only commits (and clamps) on blur or Enter,
// so a half-typed number is never snapped to the minimum mid-keystroke.
function NumberField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  onCommit,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value));
  const [seenValue, setSeenValue] = useState(value);
  // Resync when the committed value changes from outside (e.g. clamped), without an effect.
  if (seenValue !== value) {
    setSeenValue(value);
    setDraft(String(value));
  }

  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    onCommit(parsed);
    setDraft(String(Math.min(max, Math.max(min, Math.round(parsed)))));
  };

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 mb-1">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        className={fieldClass}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </div>
  );
}

function SaleButton({ venue }: { venue: Venue }) {
  const phase = useSimulationStore((s) => s.phase);
  if (phase === 'running') {
    return (
      <button type="button" className={plainButton} onClick={pauseSale}>
        Pause
      </button>
    );
  }
  if (phase === 'paused') {
    return (
      <button type="button" className={primaryButton} onClick={resumeSale}>
        Resume
      </button>
    );
  }
  return (
    <button
      type="button"
      className={primaryButton}
      onClick={() => {
        startSale(venue);
      }}
    >
      {phase === 'finished' ? 'Run again' : 'Open sales'}
    </button>
  );
}

export default function SimulationPanel({ venue }: { venue: Venue }) {
  const [open, setOpen] = useState(false);
  const config = useSimulationStore((s) => s.config);
  const phase = useSimulationStore((s) => s.phase);
  const speed = useSimulationStore((s) => s.speed);
  const heatmap = useSimulationStore((s) => s.heatmap);
  const announcement = useSimulationStore((s) => s.announcement);
  const setConfig = useSimulationStore((s) => s.setConfig);
  const setHeatmap = useSimulationStore((s) => s.setHeatmap);

  const idle = phase === 'idle' || phase === 'finished';
  const update = (partial: Parameters<typeof setConfig>[0]) => {
    setConfig(partial);
    syncUrl();
  };

  return (
    <section
      aria-label="On-sale day simulator"
      className="fixed top-40 right-4 z-50 w-72 max-h-[calc(100vh-11rem)] overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold text-gray-600 uppercase tracking-wider">Drop Day</h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="drop-day-body"
          onClick={() => {
            setOpen(!open);
          }}
          className="cursor-pointer text-xs font-semibold text-blue-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div id="drop-day-body" hidden={!open} className="mt-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          <SaleButton venue={venue} />
          <button
            type="button"
            disabled={phase === 'idle'}
            className={plainButton}
            onClick={resetSale}
          >
            Reset
          </button>
        </div>

        <fieldset>
          <legend className="text-xs font-medium text-gray-600 mb-1">Speed</legend>
          <div className="flex gap-1" role="group" aria-label="Simulation speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={speed === s}
                className={`${buttonClass} flex-1 ${
                  speed === s
                    ? 'bg-gray-900 border-gray-900 text-white'
                    : 'bg-white border-gray-300 text-gray-800 hover:bg-gray-50'
                }`}
                onClick={() => {
                  setSaleSpeed(s);
                }}
              >
                {s}×
              </button>
            ))}
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={heatmap}
            onChange={(e) => {
              setHeatmap(e.target.checked);
            }}
          />
          Heatmap (sell rate by section)
        </label>

        <fieldset disabled={!idle} className="space-y-2 border-t border-gray-200 pt-3">
          <legend className="text-xs font-bold text-gray-600 uppercase tracking-wider">
            Sale settings
          </legend>
          <NumberField
            id="sim-buyers"
            label={`Buyers (${BUYERS_MIN.toLocaleString()}–${BUYERS_MAX.toLocaleString()})`}
            value={config.buyers}
            min={BUYERS_MIN}
            max={BUYERS_MAX}
            step={1000}
            disabled={!idle}
            onCommit={(buyers) => {
              update({ buyers });
            }}
          />
          <div>
            <label htmlFor="sim-pattern" className="block text-xs font-medium text-gray-600 mb-1">
              Arrival pattern
            </label>
            <select
              id="sim-pattern"
              value={config.pattern}
              disabled={!idle}
              className={fieldClass}
              onChange={(e) => {
                const pattern = ARRIVAL_PATTERNS.find((p) => p === e.target.value);
                if (pattern) update({ pattern });
              }}
            >
              {ARRIVAL_PATTERNS.map((p) => (
                <option key={p} value={p}>
                  {PATTERN_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <NumberField
            id="sim-admit"
            label={`Queue admission (buyers/sec, ${ADMIT_MIN}–${ADMIT_MAX})`}
            value={config.admitPerSec}
            min={ADMIT_MIN}
            max={ADMIT_MAX}
            disabled={!idle}
            onCommit={(admitPerSec) => {
              update({ admitPerSec });
            }}
          />
          <NumberField
            id="sim-hold"
            label="Hold time (seconds)"
            value={Math.round(config.holdMs / 1000)}
            min={HOLD_MIN_MS / 1000}
            max={HOLD_MAX_MS / 1000}
            disabled={!idle}
            onCommit={(seconds) => {
              update({ holdMs: seconds * 1000 });
            }}
          />
          <NumberField
            id="sim-seed"
            label="Random seed"
            value={config.seed}
            min={0}
            max={4294967295}
            disabled={!idle}
            onCommit={(seed) => {
              update({ seed });
            }}
          />
        </fieldset>
      </div>
    </section>
  );
}
