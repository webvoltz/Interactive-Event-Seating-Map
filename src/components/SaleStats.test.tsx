import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SimulationEngine, type SimSample, type SimStats } from '../simulation/engine';
import { makeConfig, makeVenue } from '../simulation/fixtures';
import { useSimulationStore } from '../simulation/simulationStore';
import SaleStatsPanel from './SaleStatsPanel';
import SaleSummaryCard from './SaleSummaryCard';
import TimeSeriesChart from './TimeSeriesChart';

const row = { seats: '.'.repeat(20) };
const venue = makeVenue([[row], [row]]);

function baseStats(overrides: Partial<SimStats> = {}): SimStats {
  const engine = new SimulationEngine(venue, makeConfig({ buyers: 10 }));
  return { ...engine.getStats(), ...overrides };
}

function sample(t: number, revenue: number, queue: number, holds: number): SimSample {
  return { t, revenue, soldSeats: 0, heldSeats: 0, queue, activeHolds: holds, clashes: 0 };
}

function load(stats: SimStats, series: SimSample[] = []) {
  useSimulationStore
    .getState()
    .beginRun(new Uint8Array(40), new Map(), ['Section 1', 'Section 2'], stats);
  useSimulationStore
    .getState()
    .applyBatches(
      [{ seatChanges: new Uint32Array(), soldOutSections: [], samples: series, stats }],
      0,
    );
}

beforeEach(() => {
  useSimulationStore.getState().clearRun();
});

describe('simulation store history', () => {
  it('collects samples across batches, and drops them on reset', () => {
    const stats = baseStats();
    load(stats, [sample(0, 0, 0, 0)]);
    useSimulationStore.getState().applyBatches(
      [
        {
          seatChanges: new Uint32Array(),
          soldOutSections: [],
          samples: [sample(5000, 10, 1, 1)],
          stats,
        },
        { seatChanges: new Uint32Array(), soldOutSections: [], samples: [], stats },
      ],
      1,
    );
    expect(useSimulationStore.getState().series.map((s) => s.t)).toEqual([0, 5000]);
    useSimulationStore.getState().clearRun();
    expect(useSimulationStore.getState().series).toEqual([]);
  });

  it('announces each sold-out milestone once, at the highest one crossed', () => {
    load(baseStats({ soldPct: 10 }));
    const apply = (soldPct: number) => {
      useSimulationStore.getState().applyBatches(
        [
          {
            seatChanges: new Uint32Array(),
            soldOutSections: [],
            samples: [],
            stats: baseStats({ soldPct }),
          },
        ],
        0,
      );
      return useSimulationStore.getState().announcement;
    };
    expect(apply(30)).toBe('25 percent of seats sold.');
    // Same milestone again: nothing new to say, the last message stands.
    expect(apply(40)).toBe('25 percent of seats sold.');
    expect(apply(80)).toBe('75 percent of seats sold.');
  });

  it('remembers that the summary was dismissed until the next run', () => {
    load(baseStats());
    useSimulationStore.getState().dismissSummary();
    expect(useSimulationStore.getState().summaryDismissed).toBe(true);
    load(baseStats());
    expect(useSimulationStore.getState().summaryDismissed).toBe(false);
  });
});

describe('SaleStatsPanel', () => {
  it('shows nothing before a sale starts', () => {
    const { container } = render(<SaleStatsPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the headline numbers, live metrics and per-section bars', () => {
    const base = baseStats();
    load(
      baseStats({
        simTimeMs: 75_000,
        soldPct: 42.5,
        revenue: 1_250_000,
        queueLength: 321,
        served: 4_000,
        turnedAway: 12,
        gaveUp: 30,
        gaveUpInQueue: 20,
        gaveUpSearching: 5,
        holdsLapsed: 5,
        expiredHolds: 5,
        activeHolds: 77,
        clashes: 900,
        clashesPerSec: 3.2,
        avgWaitMs: 72_000,
        soldOutAtMs: 61_000,
        sections: base.sections.map((s, i) => ({
          ...s,
          sold: i === 0 ? 10 : 0,
          held: i === 0 ? 5 : 0,
        })),
      }),
      [sample(0, 0, 0, 0), sample(5000, 500_000, 100, 20), sample(10_000, 1_250_000, 321, 77)],
    );
    render(<SaleStatsPanel />);

    expect(screen.getByText('42.5%')).toBeInTheDocument();
    expect(screen.getByText('01:15')).toBeInTheDocument();
    expect(screen.getByText('$1.3M')).toBeInTheDocument();
    expect(screen.getByText('321')).toBeInTheDocument();
    expect(screen.getByText('1m 12s')).toBeInTheDocument();
    expect(screen.getByText('01:01')).toBeInTheDocument();
    expect(screen.getByText('900 total')).toBeInTheDocument();
    expect(screen.getByText('5 expired')).toBeInTheDocument();
    expect(screen.getByText('queue 20 · search 5 · lapsed 5')).toBeInTheDocument();

    const meter = screen.getByRole('meter', { name: 'Section 1 sold' });
    expect(meter).toHaveAttribute('aria-valuetext', '50.0% sold, 25.0% held');
    expect(screen.getByRole('meter', { name: 'Seats sold' })).toBeInTheDocument();
  });

  it('says "Not yet" until the venue sells out, and can be collapsed', async () => {
    const user = userEvent.setup();
    load(baseStats());
    render(<SaleStatsPanel />);
    expect(screen.getByText('Not yet')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Hide' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Show' })).toBeInTheDocument();
  });
});

describe('TimeSeriesChart', () => {
  const times = [0, 5000, 10_000, 15_000];
  const renderChart = (extra: Partial<Parameters<typeof TimeSeriesChart>[0]> = {}) =>
    render(
      <TimeSeriesChart
        title="Queue and holds"
        times={times}
        series={[
          { id: 'q', label: 'In queue', color: '#2a78d6', values: [0, 100, 300, 200] },
          { id: 'h', label: 'Holds', color: '#eb6834', values: [0, 10, 20, 30] },
        ]}
        formatValue={(v) => `${v} people`}
        {...extra}
      />,
    );

  it('describes itself for screen readers with the latest values, and has a legend for two series', () => {
    renderChart();
    const chart = screen.getByRole('img');
    expect(chart).toHaveAccessibleName(
      /Queue and holds\. Latest: In queue 200 people, Holds 30 people/,
    );
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(within(legend).getAllByRole('listitem')).toHaveLength(2);
  });

  it('needs no legend box for a single series', () => {
    renderChart({
      series: [{ id: 'r', label: 'Revenue', color: '#2a78d6', values: [0, 1, 2, 3] }],
      area: true,
    });
    expect(screen.queryByRole('list', { name: 'Legend' })).not.toBeInTheDocument();
  });

  it('reads points with the keyboard and shows them in a tooltip', async () => {
    const user = userEvent.setup();
    renderChart();
    const chart = screen.getByRole('img');
    chart.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('00:15', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('In queue: 200 people')).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByText('00:05', { selector: 'div' })).toBeInTheDocument();
    await user.keyboard('{Home}');
    expect(screen.getByText('00:00', { selector: 'div' })).toBeInTheDocument();
    await user.keyboard('{End}');
    expect(screen.getByText('00:15', { selector: 'div' })).toBeInTheDocument();
    await user.keyboard('x');
    await user.keyboard('{Escape}');
    expect(screen.queryByText('In queue: 200 people')).not.toBeInTheDocument();
  });

  it('follows the pointer to the nearest sample and lets go when it leaves', () => {
    renderChart();
    const chart = screen.getByRole('img');
    vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 340, 150));
    fireEvent.pointerMove(chart, { clientX: 340 * 0.2, clientY: 10 });
    expect(screen.getByText(/In queue:/)).toBeInTheDocument();
    fireEvent.pointerLeave(chart);
    expect(screen.queryByText(/In queue:/)).not.toBeInTheDocument();
    chart.focus();
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    fireEvent.blur(chart);
    expect(screen.queryByText(/In queue:/)).not.toBeInTheDocument();
  });

  it('offers the same data as a table', async () => {
    const user = userEvent.setup();
    renderChart();
    await user.click(screen.getByRole('button', { name: 'View as table' }));
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(times.length + 1);
    expect(within(table).getByText('300 people')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View as chart' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('draws nothing it cannot draw yet, and ignores hover and keys with a single point', () => {
    renderChart({
      times: [0],
      series: [{ id: 'r', label: 'Revenue', color: '#2a78d6', values: [0] }],
    });
    const chart = screen.getByRole('img');
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    fireEvent.pointerMove(chart, { clientX: 10, clientY: 10 });
    expect(screen.queryByText(/Revenue:/)).not.toBeInTheDocument();
  });
});

describe('SaleSummaryCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const finish = (overrides: Partial<SimStats> = {}) => {
    const base = baseStats();
    load(
      baseStats({
        finished: true,
        simTimeMs: 900_000,
        soldOutAtMs: 21_500,
        revenue: 32_971_500,
        avgWaitMs: 120_000,
        served: 17_000,
        turnedAway: 9_988,
        gaveUp: 5_349,
        expiredHolds: 408,
        clashes: 15_000,
        sections: base.sections.map((s, i) => ({
          ...s,
          soldOutAtMs: i === 0 ? 9_000 : null,
          sold: 15,
        })),
        ...overrides,
      }),
    );
  };

  it('stays away while the sale is running or before it starts', () => {
    const { container } = render(<SaleSummaryCard venue={venue} />);
    expect(container).toBeEmptyDOMElement();
    useSimulationStore.setState({ phase: 'running', stats: baseStats() });
    expect(container).toBeEmptyDOMElement();
  });

  it('summarises the finished sale, can be closed, and can start another run', async () => {
    class FakeWorker {
      onmessage: unknown = null;
      postMessage = vi.fn();
      terminate = vi.fn();
    }
    vi.stubGlobal('Worker', FakeWorker);
    const user = userEvent.setup();
    finish();
    useSimulationStore.setState({ phase: 'finished' });
    render(<SaleSummaryCard venue={venue} />);

    const card = screen.getByRole('region', { name: 'Sale complete' });
    expect(within(card).getByText('$33.0M')).toBeInTheDocument();
    expect(within(card).getByText('00:21')).toBeInTheDocument();
    expect(within(card).getByText('2m 00s')).toBeInTheDocument();
    expect(within(card).getByText('9,988')).toBeInTheDocument();
    expect(within(card).getByText(/Fastest to sell out:/)).toHaveTextContent('Section 1 at 00:09');
    expect(within(card).getByText(/Slowest:/)).toHaveTextContent('never sold out');

    await user.click(within(card).getByRole('button', { name: 'Run again' }));
    expect(useSimulationStore.getState().config.seed).toBeGreaterThanOrEqual(0);

    await user.click(within(card).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Sale complete' })).not.toBeInTheDocument();
  });

  it('reports a venue that never sold out', () => {
    finish({ soldOutAtMs: null, sections: [] });
    useSimulationStore.setState({ phase: 'finished' });
    render(<SaleSummaryCard venue={venue} />);
    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(screen.queryByText(/Fastest to sell out/)).not.toBeInTheDocument();
  });
});
