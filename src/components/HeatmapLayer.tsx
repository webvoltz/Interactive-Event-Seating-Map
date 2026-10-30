import { useEffect, useMemo, useRef } from 'react';
import type { Venue } from '../interfaces/venue.interfaces';
import { selectDisplayStats, useSimulationStore } from '../simulation/simulationStore';
import { useVenueStore } from '../store/seatStore';
import { paintHeatmap } from '../utils/paintHeatmap';
import { getSectionGeometry } from '../utils/sectionGeometry';
import type { VenueContentBounds } from '../utils/venueBounds';

// Half resolution: the layer is a soft wash, and a full-size canvas would cost a lot of memory.
const RESOLUTION = 0.5;

interface HeatmapLayerProps {
  venue: Venue;
  bounds: VenueContentBounds;
}

export default function HeatmapLayer({ venue, bounds }: HeatmapLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heatmap = useSimulationStore((s) => s.heatmap);
  const stats = useSimulationStore(selectDisplayStats);
  const soldOutAt = useSimulationStore((s) => s.soldOutAt);
  const activeSectionId = useVenueStore((s) => s.activeSectionId);

  const sections = useMemo(
    () =>
      venue.sections.map((section) => {
        const g = getSectionGeometry(section);
        return { id: section.id, offset: g.explodeOffset, path: new Path2D(g.coverPath) };
      }),
    [venue],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !stats) return undefined;

    let raf = 0;
    let timeout = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const draw = () => {
      const now = performance.now();
      const flashEnd = paintHeatmap(ctx, {
        sections,
        stats,
        heatmap,
        activeSectionId,
        soldOutAt,
        now,
        reducedMotion,
        origin: { x: bounds.minX, y: bounds.minY },
        resolution: RESOLUTION,
        canvasSize: { width: canvas.width, height: canvas.height },
      });
      if (flashEnd === null) return;
      // A pulsing outline needs frames; with reduced motion it just holds, then is cleared.
      if (reducedMotion) timeout = window.setTimeout(draw, Math.max(0, flashEnd - now) + 20);
      else raf = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
    };
  }, [sections, bounds, heatmap, stats, soldOutAt, activeSectionId]);

  if (!stats) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      width={Math.ceil(bounds.width * RESOLUTION)}
      height={Math.ceil(bounds.height * RESOLUTION)}
      className="absolute top-0 left-0 pointer-events-none"
      style={{ width: bounds.width, height: bounds.height }}
    />
  );
}
