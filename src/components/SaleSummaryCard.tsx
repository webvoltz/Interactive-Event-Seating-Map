import type { Venue } from '../interfaces/venue.interfaces';
import { startSale } from '../simulation/simulationController';
import { useSimulationStore } from '../simulation/simulationStore';
import {
  buildSummary,
  formatClock,
  formatDuration,
  formatMoney,
  type SectionHighlight,
} from '../simulation/statsFormat';

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-600">{label}</dt>
      <dd className="text-base font-semibold text-gray-900 tabular-nums">{value}</dd>
    </div>
  );
}

export default function SaleSummaryCard({ venue }: { venue: Venue }) {
  const phase = useSimulationStore((s) => s.phase);
  const dismissed = useSimulationStore((s) => s.summaryDismissed);
  const stats = useSimulationStore((s) => s.stats);
  const labels = useSimulationStore((s) => s.sectionLabels);
  const replaying = useSimulationStore((s) => s.replayAtMs !== null);
  const dismiss = useSimulationStore((s) => s.dismissSummary);

  if (phase !== 'finished' || dismissed || replaying || !stats) return null;

  const summary = buildSummary(stats);
  const name = (h: SectionHighlight) => labels[h.index] ?? `Section ${h.index + 1}`;

  return (
    <section
      aria-labelledby="sale-summary-title"
      className="absolute left-1/2 top-6 z-50 w-[28rem] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl border border-gray-200 bg-white p-5 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="sale-summary-title" className="text-lg font-semibold text-gray-900">
            Sale complete
          </h2>
          <p className="text-sm text-gray-600 tabular-nums">
            Ended at {formatClock(summary.saleEndedAtMs)} on the sale clock
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="cursor-pointer rounded-md px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          Close
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact
          label="Seats sold"
          value={`${summary.seatsSold.toLocaleString()} of ${summary.sellableSeats.toLocaleString()}`}
        />
        <Fact label="Revenue" value={formatMoney(summary.revenue)} />
        <Fact
          label="Time to sell out"
          value={summary.soldOutAtMs === null ? 'Never' : formatClock(summary.soldOutAtMs)}
        />
        <Fact label="Average wait" value={formatDuration(summary.avgWaitMs)} />
        <Fact label="Buyers served" value={summary.served.toLocaleString()} />
        <Fact label="Turned away" value={summary.turnedAway.toLocaleString()} />
        <Fact label="Gave up" value={summary.gaveUp.toLocaleString()} />
        <Fact label="Holds expired" value={summary.expiredHolds.toLocaleString()} />
        <Fact label="Seat clashes" value={summary.clashes.toLocaleString()} />
      </dl>

      <p className="mt-3 text-xs text-gray-600">
        {summary.sellableSeats.toLocaleString()} seats were on sale; the other{' '}
        {summary.reservedSeats.toLocaleString()} are reserved in the venue and never sold.
        {summary.unsoldSeats > 0 &&
          ` ${summary.unsoldSeats.toLocaleString()} unsold: they went back on sale when late holds lapsed, after the last buyers had left the waiting room.`}
      </p>

      {(summary.fastest ?? summary.slowest) && (
        <ul className="mt-4 space-y-1 border-t border-gray-200 pt-3 text-sm text-gray-800">
          {summary.fastest && (
            <li>
              Fastest to sell out: <strong>{name(summary.fastest)}</strong> at{' '}
              {formatClock(summary.fastest.soldOutAtMs ?? 0)}
            </li>
          )}
          {summary.slowest && (
            <li>
              Slowest: <strong>{name(summary.slowest)}</strong>{' '}
              {summary.slowest.soldOutAtMs === null
                ? `(${summary.slowest.soldPct.toFixed(1)}% sold, never sold out)`
                : `at ${formatClock(summary.slowest.soldOutAtMs)}`}
            </li>
          )}
        </ul>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => {
            startSale(venue);
          }}
          className="cursor-pointer rounded-lg border border-emerald-800 bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          Run again
        </button>
      </div>
    </section>
  );
}
