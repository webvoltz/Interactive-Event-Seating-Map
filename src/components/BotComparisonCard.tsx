import type { DetectionOutcome } from '../simulation/comparison';
import { DETECTION } from '../simulation/detection';
import { dismissComparison } from '../simulation/simulationController';
import { useSimulationStore } from '../simulation/simulationStore';
import { formatClock, formatMoney } from '../simulation/statsFormat';

// Chart palette slots 1 and 2: real fans and bots, always paired with written values.
const FANS = '#2a78d6';
const BOTS = '#eb6834';
const TRACK = '#e5e7eb';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <dt className="text-gray-600">{label}</dt>
      <dd className="font-semibold text-gray-900 tabular-nums">{value}</dd>
    </div>
  );
}

function Column({ title, outcome }: { title: string; outcome: DetectionOutcome }) {
  const sold = outcome.bestToFans + outcome.bestToBots;
  const botShare = 100 - outcome.fanShare;
  const fired = outcome.blockedBy;

  return (
    <section aria-label={title} className="rounded-lg border border-gray-200 p-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600">{title}</h3>
      <p className="mt-2 text-4xl font-semibold leading-none text-gray-900 tabular-nums">
        {outcome.fanShare.toFixed(0)}%
      </p>
      <p className="text-xs text-gray-600">of the best seats went to real fans</p>

      <div
        role="meter"
        aria-label={`${title}: share of the best seats`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(outcome.fanShare)}
        aria-valuetext={`${outcome.fanShare.toFixed(1)}% real fans, ${botShare.toFixed(1)}% bots`}
        className="mt-2 flex h-2.5 overflow-hidden rounded-full"
        style={{ backgroundColor: TRACK }}
      >
        <div style={{ width: `${outcome.fanShare}%`, backgroundColor: FANS }} />
        <div className="ml-0.5" style={{ width: `${botShare}%`, backgroundColor: BOTS }} />
      </div>
      <p className="mt-1 flex gap-3 text-[11px] text-gray-700">
        <span className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-sm"
            style={{ backgroundColor: FANS }}
          />
          Real fans {outcome.bestToFans.toLocaleString()}
        </span>
        <span className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-sm"
            style={{ backgroundColor: BOTS }}
          />
          Bots {outcome.bestToBots.toLocaleString()}
        </span>
      </p>

      <dl className="mt-3 space-y-1">
        <Row
          label="Best seats sold"
          value={`${sold.toLocaleString()} of ${outcome.bestSeatsTotal.toLocaleString()}`}
        />
        <Row label="Seats bought by bots (all)" value={outcome.botSeatsSold.toLocaleString()} />
        <Row label="Revenue to bots" value={formatMoney(outcome.botRevenue)} />
        <Row
          label="Bots blocked"
          value={
            outcome.detection
              ? `${outcome.botsBlocked.toLocaleString()} of ${outcome.botsTotal.toLocaleString()}`
              : 'detector off'
          }
        />
        <Row
          label="Real buyers blocked by mistake"
          value={outcome.humansBlocked.toLocaleString()}
        />
        <Row
          label="Time to sell out"
          value={outcome.soldOutAtMs === null ? 'Never' : formatClock(outcome.soldOutAtMs)}
        />
      </dl>
      {outcome.detection && (
        <p className="mt-2 text-[11px] text-gray-600 tabular-nums">
          Rules firing on blocked bots: speed {fired.speed.toLocaleString()} · seats per identity{' '}
          {fired.seats.toLocaleString()} · repeated pattern {fired.pattern.toLocaleString()}
        </p>
      )}
    </section>
  );
}

export default function BotComparisonCard() {
  const comparison = useSimulationStore((s) => s.comparison);
  if (comparison.status === 'idle') return null;

  if (comparison.status === 'running') {
    return (
      <section
        aria-label="Scalper bot comparison"
        aria-busy="true"
        className="absolute left-1/2 top-6 z-[55] w-[28rem] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl border border-gray-200 bg-white p-5 shadow-2xl"
      >
        <p className="text-sm font-semibold text-gray-900">
          Playing the same sale twice…{' '}
          <span className="font-normal text-gray-700">
            {comparison.finished === 0
              ? 'detector off (1 of 2)'
              : comparison.finished === 1
                ? 'detector on (2 of 2)'
                : 'finishing'}
          </span>
        </p>
        <button
          type="button"
          onClick={dismissComparison}
          className="mt-3 cursor-pointer rounded-md border border-gray-300 px-3 py-1 text-sm font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          Cancel
        </button>
      </section>
    );
  }

  const { off, on } = comparison.result;
  const gained = on.fanShare - off.fanShare;

  return (
    <section
      aria-labelledby="bot-compare-title"
      className="absolute left-1/2 top-6 z-[55] w-[40rem] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl border border-gray-200 bg-white p-5 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="bot-compare-title" className="text-lg font-semibold text-gray-900">
            Who got the best seats?
          </h2>
          <p className="text-sm text-gray-600">
            The best 10% of seats by view ({off.bestSeatsTotal.toLocaleString()}). Same crowd, same{' '}
            {off.botsTotal.toLocaleString()} bots, same seed: only detection differs.
          </p>
        </div>
        <button
          type="button"
          onClick={dismissComparison}
          className="cursor-pointer rounded-md px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          Close
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Column title="Detection off" outcome={off} />
        <Column title="Detection on" outcome={on} />
      </div>

      <p className="mt-3 text-sm font-semibold text-gray-900">
        Detection gives real fans {gained >= 0 ? '+' : ''}
        {gained.toFixed(0)} percentage points of the best seats.
      </p>
      <p className="mt-1 text-xs text-gray-600">
        An identity is blocked when {DETECTION.RULES_TO_BLOCK} of 3 rules agree: action speed
        (searches less than {DETECTION.FAST_ACTION_MS} ms apart, {DETECTION.FAST_ACTIONS_TO_FLAG}+
        times), seats per identity (more than {DETECTION.MAX_SEATS_PER_IDENTITY}), and a repeated
        pattern (the same request {DETECTION.SAME_SHAPE_STREAK} times in a row, each within{' '}
        {DETECTION.SAME_SHAPE_GAP_MS / 1000} s). Checks run every {DETECTION.SCAN_MS} ms, so a bot
        that pays inside that window can slip through.
      </p>
    </section>
  );
}
