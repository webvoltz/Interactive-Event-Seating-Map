import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDLE_VIEWER, makeBatch, makeConfig, makeVenue } from '../simulation/fixtures';
import { SimulationEngine } from '../simulation/engine';
import { AVAILABLE, HELD, RESERVED, SOLD } from '../simulation/seatBook';
import { useSimulationStore } from '../simulation/simulationStore';
import { useVenueStore } from '../store/seatStore';
import { heatColor } from '../utils/heatColor';
import { FLASH_MS, paintHeatmap, type HeatContext } from '../utils/paintHeatmap';
import { getSectionGeometry } from '../utils/sectionGeometry';
import { getVenueContentBounds } from '../utils/venueBounds';
import HeatmapLayer from './HeatmapLayer';
import Seats from './Seat';
import SimulationPanel from './SimulationPanel';

const venue = makeVenue([[{ seats: '....' }], [{ seats: '....' }]]);
const [firstSection] = venue.sections;
if (!firstSection) throw new Error('fixture has no section');

function statsFor() {
  return new SimulationEngine(venue, makeConfig({ buyers: 10 })).getStats();
}

describe('Seats while a sale is simulated', () => {
  beforeEach(() => {
    useVenueStore.setState({ selectedSeats: new Set(), soldSeats: new Set(), holds: new Map() });
    useSimulationStore.getState().clearRun();
  });

  it('shows the simulated board instead of the venue file, and keeps the viewer’s own picks', () => {
    const ids = firstSection.rows[0]?.seats.map((s) => s.id) ?? [];
    useSimulationStore
      .getState()
      .beginRun(
        Uint8Array.from([SOLD, HELD, RESERVED, AVAILABLE, 0, 0, 0, 0]),
        new Map(ids.map((id, i) => [id, i])),
        ['Section 1', 'Section 2'],
        statsFor(),
      );
    useVenueStore.setState({ selectedSeats: new Set([ids[3] ?? '']) });

    render(
      <svg>
        <Seats rows={firstSection.rows} />
      </svg>,
    );
    const label = (id: string | undefined) =>
      document.getElementById(`seat-${id}`)?.getAttribute('aria-label') ?? '';
    expect(label(ids[0])).toMatch(/sold$/);
    expect(label(ids[1])).toMatch(/held by another customer$/);
    expect(label(ids[2])).toMatch(/reserved$/);
    // Not admitted yet: a leftover pick isn't a real hold, so the board shows the truth.
    expect(label(ids[3])).toMatch(/available$/);
  });

  it('shows an admitted buyer’s own picks as selected, including seats the engine holds for them', () => {
    const ids = firstSection.rows[0]?.seats.map((s) => s.id) ?? [];
    useSimulationStore
      .getState()
      .beginRun(
        Uint8Array.from([SOLD, HELD, RESERVED, HELD, 0, 0, 0, 0]),
        new Map(ids.map((id, i) => [id, i])),
        ['Section 1', 'Section 2'],
        statsFor(),
        { ...IDLE_VIEWER, stage: 'admitted' },
      );
    useVenueStore.setState({ selectedSeats: new Set([ids[3] ?? '']) });
    render(
      <svg>
        <Seats rows={firstSection.rows} />
      </svg>,
    );
    const label = (id: string | undefined) =>
      document.getElementById(`seat-${id}`)?.getAttribute('aria-label') ?? '';
    expect(label(ids[3])).toMatch(/selected$/);
    // Someone else's hold is still theirs.
    expect(label(ids[1])).toMatch(/held by another customer$/);
  });

  it('re-renders a seat when the simulation changes its status', () => {
    const ids = firstSection.rows[0]?.seats.map((s) => s.id) ?? [];
    const status = new Uint8Array(8);
    useSimulationStore
      .getState()
      .beginRun(status, new Map(ids.map((id, i) => [id, i])), ['A', 'B'], statsFor());
    render(
      <svg>
        <Seats rows={firstSection.rows} />
      </svg>,
    );
    expect(document.getElementById(`seat-${ids[0]}`)?.getAttribute('aria-label')).toMatch(
      /available$/,
    );

    const stats = statsFor();
    useSimulationStore
      .getState()
      .applyBatches([makeBatch(stats, { seatChanges: Uint32Array.from([(0 << 2) | SOLD]) })], 0);
    // The store flips the seat; React re-renders on the version bump.
    return Promise.resolve().then(() => {
      expect(document.getElementById(`seat-${ids[0]}`)?.getAttribute('aria-label')).toMatch(
        /sold$/,
      );
    });
  });
});

describe('SimulationPanel', () => {
  const posted: { type: string }[] = [];

  class FakeWorker {
    onmessage: unknown = null;
    postMessage(message: { type: string }) {
      posted.push(message);
    }
    terminate = vi.fn();
  }

  beforeEach(() => {
    posted.length = 0;
    vi.stubGlobal('Worker', FakeWorker);
    useSimulationStore.getState().clearRun();
    useSimulationStore.setState({ phase: 'idle', speed: 10, heatmap: false });
    useSimulationStore.getState().setConfig({ buyers: 20000, pattern: 'spike', admitPerSec: 400 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps its controls out of the way until opened, and announces through a polite live region', async () => {
    const user = userEvent.setup();
    render(<SimulationPanel venue={venue} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    const toggle = screen.getByRole('button', { name: 'Show' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Open sales' })).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Open sales' })).toBeInTheDocument();
  });

  it('is fully keyboard operable: open sales, pause, resume, pick a speed, reset', async () => {
    const user = userEvent.setup();
    render(<SimulationPanel venue={venue} />);
    await user.click(screen.getByRole('button', { name: 'Show' }));

    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
    screen.getByRole('button', { name: 'Open sales' }).focus();
    await user.keyboard('{Enter}');
    expect(posted[0]?.type).toBe('init');

    useSimulationStore.getState().setPhase('running');
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '100×' }));
    expect(useSimulationStore.getState().speed).toBe(100);
    expect(screen.getByRole('button', { name: '100×' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(useSimulationStore.getState().phase).toBe('running');

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(useSimulationStore.getState().phase).toBe('idle');
  });

  it('locks the sale settings while a sale runs', async () => {
    const user = userEvent.setup();
    render(<SimulationPanel venue={venue} />);
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByLabelText(/^Buyers/)).toBeEnabled();
    useSimulationStore.setState({ phase: 'running' });
    expect(await screen.findByLabelText(/^Buyers/)).toBeDisabled();
    expect(screen.getByLabelText('Random seed')).toBeDisabled();
  });

  it('commits typed settings on blur, clamping them, and writes them to the URL', async () => {
    const user = userEvent.setup();
    render(<SimulationPanel venue={venue} />);
    await user.click(screen.getByRole('button', { name: 'Show' }));

    const buyers = screen.getByLabelText(/^Buyers/);
    await user.clear(buyers);
    await user.type(buyers, '3');
    // Mid-typing the field must not snap to the minimum.
    expect(buyers).toHaveValue(3);
    await user.tab();
    expect(buyers).toHaveValue(1000);
    expect(useSimulationStore.getState().config.buyers).toBe(1000);
    expect(window.location.search).toContain('buyers=1000');

    const seed = screen.getByLabelText('Random seed');
    await user.clear(seed);
    await user.type(seed, '777{Enter}');
    expect(useSimulationStore.getState().config.seed).toBe(777);
    expect(window.location.search).toContain('seed=777');

    const hold = screen.getByLabelText('Hold time (seconds)');
    await user.clear(hold);
    await user.type(hold, '60');
    await user.tab();
    expect(useSimulationStore.getState().config.holdMs).toBe(60_000);

    const admit = screen.getByLabelText(/^Queue admission/);
    await user.clear(admit);
    await user.tab();
    expect(admit).toHaveValue(400);

    await user.selectOptions(screen.getByLabelText('Arrival pattern'), 'waves');
    expect(useSimulationStore.getState().config.pattern).toBe('waves');
    expect(window.location.search).toContain('pattern=waves');
  });

  it('toggles the heatmap', async () => {
    const user = userEvent.setup();
    render(<SimulationPanel venue={venue} />);
    await user.click(screen.getByRole('button', { name: 'Show' }));
    await user.click(screen.getByLabelText(/Heatmap/));
    expect(useSimulationStore.getState().heatmap).toBe(true);
  });
});

describe('heatColor', () => {
  it('is a faint neutral for an idle section and hotter (redder, stronger) as it sells faster', () => {
    expect(heatColor(0, 10)).toBe('rgba(148, 163, 184, 0.18)');
    expect(heatColor(5, 0)).toBe('rgba(148, 163, 184, 0.18)');
    const hue = (c: string) => Number(/hsla\(([\d.]+)/.exec(c)?.[1]);
    const alpha = (c: string) => Number(/, ([\d.]+)\)$/.exec(c)?.[1]);
    expect(hue(heatColor(10, 10))).toBeLessThan(hue(heatColor(1, 10)));
    expect(alpha(heatColor(10, 10))).toBeGreaterThan(alpha(heatColor(1, 10)));
    expect(heatColor(99, 10)).toBe(heatColor(10, 10));
  });
});

describe('getSectionGeometry', () => {
  it('pushes a section outward from the venue centre and outlines its first and last rows', () => {
    const section = {
      id: 'S',
      label: 'S',
      transform: { x: 0, y: 0, scale: 1 },
      rows: [
        {
          index: 1,
          seats: [
            { id: 'a', col: 1, x: 1400, y: 1200, priceTier: 1, status: 'available' as const },
            { id: 'b', col: 2, x: 1410, y: 1200, priceTier: 1, status: 'available' as const },
          ],
        },
        {
          index: 2,
          seats: [
            { id: 'c', col: 1, x: 1500, y: 1200, priceTier: 1, status: 'available' as const },
            { id: 'd', col: 2, x: 1510, y: 1200, priceTier: 1, status: 'available' as const },
          ],
        },
      ],
    };
    const g = getSectionGeometry(section);
    expect(g.explodeOffset.x).toBeCloseTo(40);
    expect(g.explodeOffset.y).toBeCloseTo(0);
    expect(g.coverPath).toBe('M 1400 1200 L 1410 1200 L 1510 1200 L 1500 1200 Z');
    expect(g.labelPos).toEqual({ x: 1460, y: 1200 });
  });

  it('copes with an empty section and with one centred exactly on the venue centre', () => {
    const empty = { id: 'E', label: 'E', transform: { x: 0, y: 0, scale: 1 }, rows: [] };
    expect(getSectionGeometry(empty).coverPath).toBe('');
    const centred = {
      ...empty,
      rows: [
        {
          index: 1,
          seats: [
            { id: 'z', col: 1, x: 1200, y: 1200, priceTier: 1, status: 'available' as const },
          ],
        },
      ],
    };
    expect(getSectionGeometry(centred).explodeOffset).toEqual({ x: 0, y: 0 });
  });
});

describe('HeatmapLayer', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'Path2D',
      class {
        d: string;
        constructor(d: string) {
          this.d = d;
        }
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    useSimulationStore.getState().clearRun();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('draws nothing until a sale has started, then mounts a non-interactive canvas', () => {
    const bounds = getVenueContentBounds(venue);
    const { container } = render(<HeatmapLayer venue={venue} bounds={bounds} />);
    expect(container.querySelector('canvas')).toBeNull();

    useSimulationStore.setState({ stats: statsFor(), heatmap: true });
    const { container: after } = render(<HeatmapLayer venue={venue} bounds={bounds} />);
    const canvas = after.querySelector('canvas');
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
    expect(canvas?.className).toContain('pointer-events-none');
  });
});

describe('paintHeatmap', () => {
  function fakeContext() {
    const calls: string[] = [];
    const ctx: HeatContext = {
      setTransform: () => calls.push('transform'),
      clearRect: () => calls.push('clear'),
      translate: () => calls.push('translate'),
      fill: () => calls.push('fill'),
      stroke: () => calls.push('stroke'),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      lineJoin: 'miter',
    };
    return { ctx, calls };
  }

  beforeEach(() => {
    vi.stubGlobal(
      'Path2D',
      class {
        readonly kind = 'path';
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const makeSections = () => [
    { id: 'S-1', offset: { x: 0, y: 0 }, path: new Path2D() },
    { id: 'S-2', offset: { x: 0, y: 0 }, path: new Path2D() },
  ];
  const base = statsFor();
  const stats = {
    ...base,
    sections: base.sections.map((s, i) => ({ ...s, velocity: i === 0 ? 8 : 0, soldOut: i === 1 })),
  };
  const makeOptions = () => ({
    sections: makeSections(),
    stats,
    heatmap: true,
    activeSectionId: null,
    soldOutAt: {},
    now: 10_000,
    reducedMotion: false,
    origin: { x: 0, y: 0 },
    resolution: 0.5,
    canvasSize: { width: 100, height: 100 },
  });

  it('washes each section by how fast it is selling and darkens a sold-out one', () => {
    const { ctx, calls } = fakeContext();
    const flashEnd = paintHeatmap(ctx, makeOptions());
    expect(calls.filter((c) => c === 'fill')).toHaveLength(2);
    expect(calls).not.toContain('stroke');
    expect(flashEnd).toBeNull();
    expect(ctx.fillStyle).toBe('rgba(30, 41, 59, 0.5)');
  });

  it('leaves the open section and everything else bare when the heatmap is off', () => {
    const { ctx, calls } = fakeContext();
    paintHeatmap(ctx, { ...makeOptions(), activeSectionId: 'S-1' });
    expect(calls.filter((c) => c === 'fill')).toHaveLength(1);

    const off = fakeContext();
    paintHeatmap(off.ctx, { ...makeOptions(), heatmap: false });
    expect(off.calls).not.toContain('fill');
  });

  it('outlines a section that just sold out, until the highlight expires', () => {
    const fresh = fakeContext();
    const end = paintHeatmap(fresh.ctx, { ...makeOptions(), soldOutAt: { 1: 9_500 } });
    expect(fresh.calls).toContain('stroke');
    expect(end).toBe(9_500 + FLASH_MS);

    const stale = fakeContext();
    expect(paintHeatmap(stale.ctx, { ...makeOptions(), soldOutAt: { 1: 1_000 } })).toBeNull();
    expect(stale.calls).not.toContain('stroke');

    // Reduced motion holds a steady outline rather than pulsing.
    const still = fakeContext();
    paintHeatmap(still.ctx, { ...makeOptions(), soldOutAt: { 1: 9_500 }, reducedMotion: true });
    expect(still.ctx.strokeStyle).toMatch(/^rgba\(220, 38, 38, 0\.\d+\)$/);
  });

  it('skips a section the stats do not know about', () => {
    const { ctx, calls } = fakeContext();
    paintHeatmap(ctx, { ...makeOptions(), stats: { ...stats, sections: [] } });
    expect(calls).not.toContain('fill');
  });
});
