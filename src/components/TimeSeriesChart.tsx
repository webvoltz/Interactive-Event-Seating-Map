import { useId, useState } from 'react';
import { formatClock, formatCompact, niceTicks } from '../simulation/statsFormat';

export interface ChartSeries {
  id: string;
  label: string;
  // Mark colour only: text always wears the neutral ink classes.
  color: string;
  values: readonly number[];
}

interface TimeSeriesChartProps {
  title: string;
  // Sample times (ms), shared by every series.
  times: readonly number[];
  series: readonly ChartSeries[];
  formatValue: (value: number) => string;
  formatAxis?: (value: number) => string;
  // Wash under a lone line.
  area?: boolean;
}

const WIDTH = 340;
const HEIGHT = 124;
const MARGIN = { left: 42, right: 12, top: 10, bottom: 22 };
const MIN_SPAN_MS = 60_000;
const GRID = '#e5e7eb';
const AXIS_TEXT = '#6b7280';
const SURFACE = '#ffffff';

export default function TimeSeriesChart({
  title,
  times,
  series,
  formatValue,
  formatAxis = formatCompact,
  area = false,
}: TimeSeriesChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const tooltipId = useId();

  const lastTime = times.at(-1) ?? 0;
  const span = Math.max(lastTime, MIN_SPAN_MS);
  const peak = Math.max(0, ...series.flatMap((s) => s.values));
  const ticks = niceTicks(peak);
  const yMax = ticks.at(-1) ?? 1;

  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (t: number) => MARGIN.left + (t / span) * plotW;
  const y = (v: number) => MARGIN.top + plotH - (v / yMax) * plotH;

  const pathFor = (values: readonly number[]) =>
    values
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(times[i] ?? 0).toFixed(1)} ${y(v).toFixed(1)}`)
      .join(' ');

  const nearestIndex = (clientX: number, rect: DOMRect) => {
    const t = ((clientX - rect.left) / rect.width) * WIDTH;
    const target = ((t - MARGIN.left) / plotW) * span;
    let best = 0;
    for (let i = 1; i < times.length; i++) {
      if (Math.abs((times[i] ?? 0) - target) < Math.abs((times[best] ?? 0) - target)) best = i;
    }
    return best;
  };

  const lastIndex = times.length - 1;
  const move = (delta: number) => {
    setHover((current) => Math.min(lastIndex, Math.max(0, (current ?? lastIndex) + delta)));
  };

  const latestSummary = series
    .map((s) => `${s.label} ${formatValue(s.values.at(-1) ?? 0)}`)
    .join(', ');
  const hoverTime = hover === null ? null : (times[hover] ?? 0);
  const ready = times.length > 1;

  return (
    <figure className="m-0">
      <figcaption className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-gray-800">{title}</span>
        <button
          type="button"
          aria-pressed={asTable}
          onClick={() => {
            setAsTable(!asTable);
          }}
          className="cursor-pointer text-xs font-medium text-blue-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          {asTable ? 'View as chart' : 'View as table'}
        </button>
      </figcaption>

      {series.length > 1 && (
        <ul className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-700" aria-label="Legend">
          {series.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-3 rounded"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      {asTable ? (
        <div className="mt-2 max-h-40 overflow-auto rounded border border-gray-200">
          <table className="w-full text-left text-xs text-gray-800">
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th scope="col" className="px-2 py-1 font-semibold">
                  Sale clock
                </th>
                {series.map((s) => (
                  <th key={s.id} scope="col" className="px-2 py-1 font-semibold">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {times.map((t, i) => (
                <tr key={t} className="border-t border-gray-100">
                  <td className="px-2 py-1 tabular-nums">{formatClock(t)}</td>
                  {series.map((s) => (
                    <td key={s.id} className="px-2 py-1 tabular-nums">
                      {formatValue(s.values[i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative mt-1">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="block w-full touch-none focus-visible:outline-2 focus-visible:outline-blue-600"
            role="img"
            tabIndex={0}
            aria-label={`${title}. Latest: ${latestSummary}. Use the arrow keys to read earlier points.`}
            aria-describedby={hover === null ? undefined : tooltipId}
            onPointerMove={(e) => {
              if (ready) setHover(nearestIndex(e.clientX, e.currentTarget.getBoundingClientRect()));
            }}
            onPointerLeave={() => {
              setHover(null);
            }}
            onBlur={() => {
              setHover(null);
            }}
            onKeyDown={(e) => {
              if (!ready) return;
              if (e.key === 'ArrowLeft') move(-1);
              else if (e.key === 'ArrowRight') move(1);
              else if (e.key === 'Home') setHover(0);
              else if (e.key === 'End') setHover(lastIndex);
              else if (e.key === 'Escape') setHover(null);
              else return;
              e.preventDefault();
            }}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={WIDTH - MARGIN.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke={GRID}
                  strokeWidth={1}
                />
                <text
                  x={MARGIN.left - 6}
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="central"
                  fontSize={10}
                  fill={AXIS_TEXT}
                >
                  {formatAxis(tick)}
                </text>
              </g>
            ))}
            {[0, 0.5, 1].map((f) => (
              <text
                key={f}
                x={x(span * f)}
                y={HEIGHT - 6}
                textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}
                fontSize={10}
                fill={AXIS_TEXT}
              >
                {formatClock(span * f)}
              </text>
            ))}

            {ready &&
              series.map((s) => {
                const lastV = s.values.at(-1) ?? 0;
                return (
                  <g key={s.id}>
                    {area && series.length === 1 && (
                      <path
                        d={`${pathFor(s.values)} L${x(lastTime).toFixed(1)} ${y(0)} L${x(0)} ${y(0)} Z`}
                        fill={s.color}
                        fillOpacity={0.1}
                      />
                    )}
                    <path
                      d={pathFor(s.values)}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    <circle
                      cx={x(lastTime)}
                      cy={y(lastV)}
                      r={4}
                      fill={s.color}
                      stroke={SURFACE}
                      strokeWidth={2}
                    />
                  </g>
                );
              })}

            {hover !== null && hoverTime !== null && (
              <g pointerEvents="none">
                <line
                  x1={x(hoverTime)}
                  x2={x(hoverTime)}
                  y1={MARGIN.top}
                  y2={MARGIN.top + plotH}
                  stroke={AXIS_TEXT}
                  strokeWidth={1}
                />
                {series.map((s) => (
                  <circle
                    key={s.id}
                    cx={x(hoverTime)}
                    cy={y(s.values[hover] ?? 0)}
                    r={4}
                    fill={s.color}
                    stroke={SURFACE}
                    strokeWidth={2}
                  />
                ))}
              </g>
            )}
          </svg>

          {hover !== null && hoverTime !== null && (
            <div
              id={tooltipId}
              className="pointer-events-none absolute top-0 z-10 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 shadow-md"
              style={{
                left: `${(x(hoverTime) / WIDTH) * 100}%`,
                transform:
                  x(hoverTime) > WIDTH / 2 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)',
              }}
            >
              <div className="font-semibold tabular-nums">{formatClock(hoverTime)}</div>
              {series.map((s) => (
                <div key={s.id} className="flex items-center gap-1.5 tabular-nums">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  {s.label}: {formatValue(s.values[hover] ?? 0)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
