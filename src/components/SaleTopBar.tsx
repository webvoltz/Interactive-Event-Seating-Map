import { goLive, joinQueue, leaveQueue, scrubTo } from '../simulation/simulationController';
import { selectDisplayStats, useSimulationStore } from '../simulation/simulationStore';
import { formatClock } from '../simulation/statsFormat';
import { TICK_MS } from '../simulation/engine';

const buttonClass =
  'cursor-pointer rounded-lg border px-3 py-1 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

// "about 1m 05s": waits are estimates, so they are rounded to the second and prefixed.
function formatWait(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 1) return 'under 1s';
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

function ReplayTimeline() {
  const latest = useSimulationStore((s) => s.stats?.simTimeMs ?? 0);
  const replayAt = useSimulationStore((s) => s.replayAtMs);
  const phase = useSimulationStore((s) => s.phase);
  const value = replayAt ?? latest;
  const live = replayAt === null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <label htmlFor="sale-timeline" className="text-xs font-semibold text-gray-700">
        Timeline
      </label>
      <input
        id="sale-timeline"
        type="range"
        min={0}
        max={Math.max(latest, TICK_MS)}
        step={TICK_MS}
        value={value}
        aria-valuetext={`${formatClock(value)} of ${formatClock(latest)}`}
        onChange={(e) => {
          scrubTo(Number(e.target.value));
        }}
        className="min-w-[10rem] flex-1 accent-blue-600"
      />
      <span className="w-24 text-right text-xs tabular-nums text-gray-800">
        {formatClock(value)} / {formatClock(latest)}
      </span>
      {live ? (
        <span className="w-20 text-center text-xs font-semibold text-emerald-700">
          {phase === 'running' ? 'Live' : phase === 'finished' ? 'Ended' : 'Paused'}
        </span>
      ) : (
        <button
          type="button"
          onClick={goLive}
          className={`${buttonClass} w-20 border-blue-700 bg-blue-600 py-0.5 text-white hover:bg-blue-700`}
        >
          Go live
        </button>
      )}
    </div>
  );
}

function WaitingRoom() {
  const stats = useSimulationStore(selectDisplayStats);
  const viewer = useSimulationStore((s) => s.viewer);
  const phase = useSimulationStore((s) => s.phase);
  const speed = useSimulationStore((s) => s.speed);
  const admitPerSec = useSimulationStore((s) => s.config.admitPerSec);
  const replaying = useSimulationStore((s) => s.replayAtMs !== null);

  if (!stats) return null;

  // The viewer's clock runs at the chosen speed, so a sale-time wait shrinks by that factor on the wall clock.
  const wallWait = (saleMs: number) => formatWait(saleMs / speed);
  const queueWait = (stats.queueLength / admitPerSec) * 1000;
  const paused = stats.seats.available === 0 && stats.seats.held > 0;
  const canJoin = (phase === 'running' || phase === 'paused') && !replaying;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <p className="text-xs text-gray-800 tabular-nums">
        <span className="font-semibold">Waiting room</span> · {stats.queueLength.toLocaleString()}{' '}
        in queue · admitting {admitPerSec.toLocaleString()}/s
        {paused
          ? ' · paused: every seat is held'
          : stats.queueLength > 0
            ? ` · new arrivals wait about ${wallWait(queueWait)}`
            : ''}
      </p>

      <div className="flex items-center gap-2 text-sm">
        {viewer.stage === 'queued' && (
          <>
            <span className="font-semibold text-gray-900 tabular-nums">
              You are #{(viewer.position ?? 0).toLocaleString()}
              {viewer.etaMs !== null && (
                <span className="font-normal text-gray-700"> · about {wallWait(viewer.etaMs)}</span>
              )}
            </span>
            <button
              type="button"
              onClick={leaveQueue}
              className={`${buttonClass} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}
            >
              Leave
            </button>
          </>
        )}
        {viewer.stage === 'admitted' && (
          <>
            <span className="font-semibold text-emerald-700">
              Your turn: pick seats and check out
            </span>
            <button
              type="button"
              onClick={leaveQueue}
              className={`${buttonClass} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}
            >
              Leave sale
            </button>
          </>
        )}
        {viewer.stage === 'turned-away' && (
          <span className="font-semibold text-red-700">Sold out before your turn</span>
        )}
        {(viewer.stage === 'none' || viewer.stage === 'left' || viewer.stage === 'turned-away') && (
          <button
            type="button"
            disabled={!canJoin}
            onClick={joinQueue}
            className={`${buttonClass} border-emerald-800 bg-emerald-700 text-white hover:bg-emerald-800`}
          >
            Join the waiting room
          </button>
        )}
      </div>
    </div>
  );
}

// Sits along the bottom of the map, clear of the stats panel (left), zoom buttons (right) and
// the section buttons above it, so none of the map is covered.
export default function SaleTopBar() {
  const active = useSimulationStore((s) => s.stats !== null);
  if (!active) return null;

  return (
    <section
      aria-label="Waiting room and timeline"
      className="pointer-events-auto space-y-1.5 lg:absolute lg:bottom-4 lg:left-[24rem] lg:right-24 lg:z-40 rounded-xl border border-gray-200 bg-white px-4 py-2 shadow-xl"
    >
      <WaitingRoom />
      <ReplayTimeline />
    </section>
  );
}
