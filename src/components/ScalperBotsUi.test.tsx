import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DetectionComparison, DetectionOutcome } from '../simulation/comparison';
import { SimulationEngine, type SimStats } from '../simulation/engine';
import { IDLE_VIEWER, makeBatch, makeConfig, makeVenue } from '../simulation/fixtures';
import * as controller from '../simulation/simulationController';
import { useSimulationStore } from '../simulation/simulationStore';
import { FakeWorker } from '../test/fakeWorker';
import BotComparisonCard from './BotComparisonCard';
import SaleStatsPanel from './SaleStatsPanel';
import SaleSummaryCard from './SaleSummaryCard';
import SimulationPanel from './SimulationPanel';

const row = { seats: '.'.repeat(12) };
const venue = makeVenue([[row], [row]]);

function statsWithBots(
  bots: Partial<SimStats['bots']> = {},
  rest: Partial<SimStats> = {},
): SimStats {
  const base = new SimulationEngine(venue, makeConfig({ buyers: 10, bots: 8 })).getStats();
  return { ...base, ...rest, bots: { ...base.bots, ...bots } };
}

function outcome(partial: Partial<DetectionOutcome>): DetectionOutcome {
  return {
    detection: false,
    fanShare: 30,
    bestSeatsTotal: 1129,
    bestToFans: 339,
    bestToBots: 790,
    botsTotal: 500,
    botsBlocked: 0,
    humansBlocked: 0,
    botSeatsSold: 5994,
    botRevenue: 19_500_000,
    revenue: 33_000_000,
    soldOutAtMs: 27_000,
    simTimeMs: 1_000_000,
    blockedBy: { speed: 0, seats: 0, pattern: 0 },
    ...partial,
  };
}

const comparison: DetectionComparison = {
  off: outcome({}),
  on: outcome({
    detection: true,
    fanShare: 98,
    bestToFans: 1105,
    bestToBots: 24,
    botsBlocked: 497,
    botSeatsSold: 24,
    botRevenue: 168_000,
    blockedBy: { speed: 497, seats: 99, pattern: 486 },
  }),
};

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  controller.resetSale();
  controller.dismissComparison();
  useSimulationStore.setState({ phase: 'idle' });
  useSimulationStore.getState().setConfig({ bots: 0, detection: false, buyers: 20_000 });
});

afterEach(() => {
  controller.dismissComparison();
  controller.resetSale();
  vi.unstubAllGlobals();
});

describe('the scalper bot controls', () => {
  it('sets the bot count and detection, saving both in the URL', async () => {
    const user = userEvent.setup();
    render(<SimulationPanel venue={venue} />);
    await user.click(screen.getByRole('button', { name: 'Show' }));

    const bots = screen.getByLabelText(/^Scalper bots/);
    await user.clear(bots);
    await user.type(bots, '500{Enter}');
    expect(useSimulationStore.getState().config.bots).toBe(500);
    expect(window.location.search).toContain('bots=500');

    const detect = screen.getByLabelText('Block bots (detection rules)');
    expect(detect).not.toBeChecked();
    await user.click(detect);
    expect(useSimulationStore.getState().config.detection).toBe(true);
    expect(window.location.search).toContain('detect=1');
  });

  it('only offers the comparison once there are bots, and starts it in a worker of its own', async () => {
    const user = userEvent.setup();
    render(<SimulationPanel venue={venue} />);
    await user.click(screen.getByRole('button', { name: 'Show' }));

    const compare = screen.getByRole('button', { name: 'Compare detection off vs on' });
    expect(compare).toBeDisabled();
    expect(screen.getByText('Add scalper bots above to compare.')).toBeInTheDocument();

    useSimulationStore.getState().setConfig({ bots: 300 });
    expect(await screen.findByText(/Plays this sale twice/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Compare detection off vs on' }));

    const worker = FakeWorker.latest();
    expect(worker.sent[0]).toMatchObject({ type: 'compare', config: { bots: 300 } });
    expect(await screen.findByRole('button', { name: 'Comparing…' })).toBeDisabled();
  });
});

describe('the comparison run', () => {
  it('follows the worker through two sales and then shows the result', () => {
    controller.runDetectionComparison(venue);
    const worker = FakeWorker.latest();
    expect(useSimulationStore.getState().comparison).toEqual({ status: 'running', finished: 0 });

    worker.emit({ type: 'comparisonProgress', finished: 1 });
    expect(useSimulationStore.getState().comparison).toEqual({ status: 'running', finished: 1 });

    worker.emit({ type: 'comparison', result: comparison });
    const state = useSimulationStore.getState();
    expect(state.comparison).toEqual({ status: 'done', result: comparison });
    expect(state.announcement).toMatch(/30 percent .* without detection and 98 percent with it/);
    expect(worker.terminated).toBe(true);
  });

  it('can be cancelled or dismissed, and a new run replaces an old one', () => {
    controller.runDetectionComparison(venue);
    const first = FakeWorker.latest();
    controller.runDetectionComparison(venue);
    expect(first.terminated).toBe(true);
    const second = FakeWorker.latest();
    controller.dismissComparison();
    expect(second.terminated).toBe(true);
    expect(useSimulationStore.getState().comparison).toEqual({ status: 'idle' });
  });

  it('is not confused with the live sale’s own worker', () => {
    controller.startSale(venue);
    const live = FakeWorker.latest();
    live.emit({ type: 'comparison', result: comparison });
    live.emit({ type: 'comparisonProgress', finished: 2 });
    expect(useSimulationStore.getState().comparison).toEqual({ status: 'idle' });
  });
});

describe('BotComparisonCard', () => {
  it('stays away until a comparison is started', () => {
    const { container } = render(<BotComparisonCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says which of the two sales it is playing, and can be cancelled', async () => {
    const user = userEvent.setup();
    useSimulationStore.setState({ comparison: { status: 'running', finished: 0 } });
    const { rerender } = render(<BotComparisonCard />);
    expect(screen.getByText(/detector off \(1 of 2\)/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Scalper bot comparison' })).toHaveAttribute(
      'aria-busy',
      'true',
    );

    useSimulationStore.setState({ comparison: { status: 'running', finished: 1 } });
    rerender(<BotComparisonCard />);
    expect(screen.getByText(/detector on \(2 of 2\)/)).toBeInTheDocument();
    useSimulationStore.setState({ comparison: { status: 'running', finished: 2 } });
    rerender(<BotComparisonCard />);
    expect(screen.getByText(/finishing/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useSimulationStore.getState().comparison).toEqual({ status: 'idle' });
  });

  it('puts the two sales side by side with every figure written out', async () => {
    const user = userEvent.setup();
    useSimulationStore.setState({ comparison: { status: 'done', result: comparison } });
    render(<BotComparisonCard />);

    expect(screen.getByRole('heading', { name: 'Who got the best seats?' })).toBeInTheDocument();
    const off = screen.getByRole('region', { name: 'Detection off' });
    const on = screen.getByRole('region', { name: 'Detection on' });
    expect(within(off).getByText('30%')).toBeInTheDocument();
    expect(within(off).getByText('detector off')).toBeInTheDocument();
    expect(within(on).getByText('98%')).toBeInTheDocument();
    expect(within(on).getByText('497 of 500')).toBeInTheDocument();
    expect(
      within(on).getByText(/speed 497 · seats per identity 99 · repeated pattern 486/),
    ).toBeInTheDocument();
    expect(within(on).getByRole('meter')).toHaveAttribute(
      'aria-valuetext',
      '98.0% real fans, 2.0% bots',
    );
    expect(within(off).getByText('Real fans 339')).toBeInTheDocument();
    expect(
      screen.getByText('Detection gives real fans +68 percentage points of the best seats.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 of 3 rules agree/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(useSimulationStore.getState().comparison).toEqual({ status: 'idle' });
  });

  it('copes with detection making things worse, and a sale that never sold out', () => {
    useSimulationStore.setState({
      comparison: {
        status: 'done',
        result: {
          off: outcome({ fanShare: 50, soldOutAtMs: null }),
          on: outcome({ detection: true, fanShare: 40 }),
        },
      },
    });
    render(<BotComparisonCard />);
    expect(
      screen.getByText('Detection gives real fans -10 percentage points of the best seats.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
  });
});

describe('bots in the stats panel and the summary', () => {
  const live = (stats: SimStats) => {
    useSimulationStore
      .getState()
      .beginRun(new Uint8Array(24), new Map(), ['Section 1', 'Section 2'], stats);
    useSimulationStore.getState().applyBatches([makeBatch(stats, { viewer: IDLE_VIEWER })], 0);
  };

  it('shows nothing about bots in a sale without any', () => {
    live(new SimulationEngine(venue, makeConfig({ buyers: 10 })).getStats());
    render(<SaleStatsPanel />);
    expect(screen.queryByRole('group', { name: 'Scalper bots' })).not.toBeInTheDocument();
  });

  it('shows how many bots were blocked, what they bought, and the fans’ share of the best seats', () => {
    live(
      statsWithBots({
        identities: 500,
        detection: true,
        blocked: 497,
        humansBlocked: 0,
        seatsSold: 24,
        revenue: 168_000,
        fanShare: 97.9,
        bestSeats: { total: 1129, soldToFans: 1105, soldToBots: 24 },
      }),
    );
    render(<SaleStatsPanel />);
    const group = screen.getByRole('group', { name: 'Scalper bots' });
    expect(within(group).getByText(/detection on/)).toBeInTheDocument();
    expect(within(group).getByText('497 of 500')).toBeInTheDocument();
    expect(within(group).getByText('0 real buyers blocked')).toBeInTheDocument();
    expect(within(group).getByText('24')).toBeInTheDocument();
    expect(within(group).getByText('$168K revenue')).toBeInTheDocument();
    expect(within(group).getByText('98%')).toBeInTheDocument();
    expect(within(group).getByText('24 of 1,129 went to bots')).toBeInTheDocument();
  });

  it('adds a bot line to the end-of-sale summary', () => {
    live(
      statsWithBots(
        { identities: 500, blocked: 0, seatsSold: 5994, fanShare: 30 },
        { finished: true },
      ),
    );
    useSimulationStore.setState({ phase: 'finished' });
    render(<SaleSummaryCard venue={venue} />);
    expect(
      screen.getByText(
        /500 bots, 0 blocked \(detection off\), 5,994 seats bought by bots\. Real fans got 30% of the best seats\./,
      ),
    ).toBeInTheDocument();
  });
});
