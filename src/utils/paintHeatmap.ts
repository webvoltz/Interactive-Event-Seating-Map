import type { SimStats } from '../simulation/engine';
import { heatColor } from './heatColor';

// Only what painting needs, so it can be driven by a plain stand-in in tests.
export type HeatContext = Pick<
  CanvasRenderingContext2D,
  | 'setTransform'
  | 'clearRect'
  | 'translate'
  | 'fill'
  | 'stroke'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineJoin'
>;

export interface PaintSection {
  id: string;
  offset: { x: number; y: number };
  path: Path2D;
}

export interface PaintOptions {
  sections: readonly PaintSection[];
  stats: SimStats;
  heatmap: boolean;
  activeSectionId: string | null;
  // Section index -> `now` clock reading when it sold out.
  soldOutAt: Readonly<Record<number, number>>;
  now: number;
  reducedMotion: boolean;
  // Venue-space point drawn at the canvas origin, and canvas pixels per venue unit.
  origin: { x: number; y: number };
  resolution: number;
  canvasSize: { width: number; height: number };
}

export const FLASH_MS = 2_000;

// Returns the clock reading at which the last sell-out highlight ends, or null if none is showing.
export function paintHeatmap(ctx: HeatContext, options: PaintOptions): number | null {
  const { sections, stats, heatmap, activeSectionId, soldOutAt, now, reducedMotion } = options;
  const { origin, resolution, canvasSize } = options;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

  const hottest = Math.max(0, ...stats.sections.map((s) => s.velocity));
  let lastFlashEnd: number | null = null;

  for (const [i, section] of sections.entries()) {
    const live = stats.sections[i];
    if (!live) continue;
    ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
    ctx.translate(section.offset.x - origin.x, section.offset.y - origin.y);

    // The open section shows its seats, so the wash stays off it.
    if (heatmap && section.id !== activeSectionId) {
      ctx.fillStyle = live.soldOut ? 'rgba(30, 41, 59, 0.5)' : heatColor(live.velocity, hottest);
      ctx.fill(section.path);
    }

    const flashedAt = soldOutAt[i];
    if (flashedAt !== undefined && now - flashedAt < FLASH_MS) {
      lastFlashEnd = Math.max(lastFlashEnd ?? 0, flashedAt + FLASH_MS);
      const fade = 1 - (now - flashedAt) / FLASH_MS;
      const pulse = reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(now / 90);
      ctx.lineWidth = 16;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = `rgba(220, 38, 38, ${Math.max(0.15, fade) * pulse})`;
      ctx.stroke(section.path);
    }
  }

  return lastFlashEnd;
}
