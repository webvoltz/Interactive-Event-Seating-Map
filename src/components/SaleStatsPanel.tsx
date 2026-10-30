import { useState } from 'react';
import { selectDisplayStats, useSimulationStore } from '../simulation/simulationStore';
import {
  formatClock,
  formatDuration,
  formatMoney,
  formatMoneyAxis,
  sectionShares,
} from '../simulation/statsFormat';
import TimeSeriesChart, { type ChartSeries } from './TimeSeriesChart';

// Categorical slots 1 and 2 of the reference palette (adjacent pair validated for colour-blind safety).
const BLUE = '#2a78d6';
const ORANGE = '#eb6834';
const BLUE_LIGHT = '#9ec5f4';
const TRACK = '#e5e7eb';

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-md bg-gray-50 px-2 py-1.5">
      <dt className="text-[11px] text-gray-600">{label}</dt>
      <dd className="text-sm font-semibold text-gray-900 tabular-nums">{value}</dd>
      {note && <dd className="text-[11px] text-gray-600 tabular-nums">{note}</dd>}
    </div>
  );
}

export default function SaleStatsPanel() {
  const [open, setOpen] = useState(true);
  const stats = useSimulationStore(selectDisplayStats);
  const allSeries = useSimulationStore((s) => s.series);
  const replayAt = useSimulationStore((s) => s.replayAtMs);
  const labels = useSimulationStore((s) => s.sectionLabels);

  if (!stats) return null;

  // Charts stop at the moment being replayed.
  const series = replayAt === null ? allSeries : allSeries.filter((p) => p.t <= replayAt);
  const times = series.map((p) => p.t);
  const revenueSeries: ChartSeries[] = [
    { id: 'revenue', label: 'Revenue', color: BLUE, values: series.map((p) => p.revenue) },
  ];
  const crowdSeries: ChartSeries[] = [
    { id: 'queue', label: 'In queue', color: BLUE, values: series.map((p) => p.queue) },
    { id: 'holds', label: 'Active holds', color: ORANGE, values: series.map((p) => p.activeHolds) },
  ];
  const sellable = stats.seats.total - stats.seats.reserved;

  return (
    <section
      aria-label="Live sale statistics"
      className="absolute bottom-4 left-4 z-40 w-[22rem] max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold text-gray-600 uppercase tracking-wider">Sale stats</h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="sale-stats-body"
          onClick={() => {
            setOpen(!open);
          }}
          className="cursor-pointer text-xs font-semibold text-blue-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      <div id="sale-stats-body" hidden={!open} className="mt-3 space-y-4">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-5xl font-semibold leading-none text-gray-900 tabular-nums">
              {stats.soldPct.toFixed(1)}%
              <span className="ml-2 text-sm font-medium text-gray-600">sold</span>
            </p>
            <p className="text-right text-xs text-gray-600 tabular-nums">
              Sale clock
              <br />
              <span className="text-sm font-semibold text-gray-900">
                {formatClock(stats.simTimeMs)}
              </span>
            </p>
          </div>
          <div
            role="meter"
            aria-label="Seats sold"
            aria-valuemin={0}
            aria-valuemax={sellable}
            aria-valuenow={stats.seats.sold}
            aria-valuetext={`${stats.seats.sold.toLocaleString()} of ${sellable.toLocaleString()} seats sold`}
            className="mt-2 flex h-2 overflow-hidden rounded-full"
            style={{ backgroundColor: TRACK }}
          >
            <div
              style={{ width: `${(stats.seats.sold / sellable) * 100}%`, backgroundColor: BLUE }}
            />
            <div
              className="ml-0.5"
              style={{
                width: `${(stats.seats.held / sellable) * 100}%`,
                backgroundColor: BLUE_LIGHT,
              }}
            />
          </div>
          <p className="mt-1 text-xs text-gray-600 tabular-nums">
            {stats.seats.sold.toLocaleString()} sold · {stats.seats.held.toLocaleString()} held ·{' '}
            {stats.seats.available.toLocaleString()} available
          </p>
          <p className="text-xs text-gray-600 tabular-nums">
            {sellable.toLocaleString()} on sale + {stats.seats.reserved.toLocaleString()} reserved
            (never for sale) = {stats.seats.total.toLocaleString()} seats
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-2">
          <Tile label="Revenue" value={formatMoney(stats.revenue)} />
          <Tile
            label="Time to sell out"
            value={stats.soldOutAtMs === null ? 'Not yet' : formatClock(stats.soldOutAtMs)}
          />
          <Tile label="In queue" value={stats.queueLength.toLocaleString()} />
          <Tile
            label="Active holds"
            value={stats.activeHolds.toLocaleString()}
            note={`${stats.expiredHolds.toLocaleString()} expired`}
          />
          <Tile
            label="Seat clashes per second"
            value={stats.clashesPerSec.toFixed(1)}
            note={`${stats.clashes.toLocaleString()} total`}
          />
          <Tile label="Average wait" value={formatDuration(stats.avgWaitMs)} />
          <Tile label="Buyers served" value={stats.served.toLocaleString()} />
          <Tile label="Turned away" value={stats.turnedAway.toLocaleString()} />
          <Tile
            label="Gave up"
            value={stats.gaveUp.toLocaleString()}
            note={`queue ${stats.gaveUpInQueue.toLocaleString()} · search ${stats.gaveUpSearching.toLocaleString()} · lapsed ${stats.holdsLapsed.toLocaleString()}`}
          />
        </dl>

        <TimeSeriesChart
          title="Revenue over time"
          times={times}
          series={revenueSeries}
          formatValue={formatMoney}
          formatAxis={formatMoneyAxis}
          area
        />
        <TimeSeriesChart
          title="Queue and active holds"
          times={times}
          series={crowdSeries}
          formatValue={(v) => v.toLocaleString()}
        />

        <div>
          <h3 className="text-xs font-semibold text-gray-800">Sold by section</h3>
          <ul className="mt-1 flex gap-3 text-xs text-gray-700" aria-label="Legend">
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-3 rounded-sm"
                style={{ backgroundColor: BLUE }}
              />
              Sold
            </li>
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-3 rounded-sm"
                style={{ backgroundColor: BLUE_LIGHT }}
              />
              Held
            </li>
          </ul>
          <ul className="mt-2 space-y-1.5">
            {stats.sections.map((section, i) => {
              const share = sectionShares(section);
              return (
                <li
                  key={labels[i] ?? i}
                  className="grid grid-cols-[4.5rem_1fr_3rem] items-center gap-2 text-xs"
                >
                  <span className="text-gray-700">{labels[i] ?? `Section ${i + 1}`}</span>
                  <div
                    role="meter"
                    aria-label={`${labels[i] ?? `Section ${i + 1}`} sold`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(share.sold)}
                    aria-valuetext={`${share.sold.toFixed(1)}% sold, ${share.held.toFixed(1)}% held`}
                    className="flex h-2 overflow-hidden rounded-full"
                    style={{ backgroundColor: TRACK }}
                  >
                    <div style={{ width: `${share.sold}%`, backgroundColor: BLUE }} />
                    <div
                      className="ml-0.5"
                      style={{ width: `${share.held}%`, backgroundColor: BLUE_LIGHT }}
                    />
                  </div>
                  <span className="text-right font-medium text-gray-900 tabular-nums">
                    {share.sold.toFixed(0)}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
