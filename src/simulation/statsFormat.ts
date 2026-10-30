import type { SectionStats, SimStats } from './engine';

// 75000 -> "01:15"; long sales roll over to "1:02:03".
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${String(minutes).padStart(2, '0')}:${seconds}`;
}

// 72000 -> "1m 12s": for averages, where a clock reading would look like a time of day.
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

// Compact from 1,000 up: 950 -> "$950", 32,971,500 -> "$33.0M".
export function formatMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return `$${Math.round(value)}`;
}

// Axis flavour of formatMoney: no trailing decimals on round ticks ($20M, not $20.0M).
export function formatMoneyAxis(value: number): string {
  return `$${formatCompact(value)}`;
}

// Compact axis labels: 0 / 500 / 1K / 2.5K.
export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${+(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

// Round axis ticks (0 and then `count` steps) that cover `max` with a 1/2/5 step.
export function niceTicks(max: number, count = 3): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / magnitude;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
  const ticks = [0];
  while ((ticks.at(-1) ?? 0) < max) ticks.push((ticks.at(-1) ?? 0) + step);
  return ticks;
}

// Share of a section's sellable seats (everything except reserved) that is sold or held.
export function sectionShares(section: SectionStats): { sold: number; held: number } {
  const sellable = section.total - section.reserved;
  if (sellable <= 0) return { sold: 0, held: 0 };
  return { sold: (section.sold / sellable) * 100, held: (section.held / sellable) * 100 };
}

export interface SectionHighlight {
  index: number;
  soldOutAtMs: number | null;
  soldPct: number;
}

export interface SaleSummary {
  seatsSold: number;
  sellableSeats: number;
  // Seats in the venue file that were never on sale.
  reservedSeats: number;
  // Seats still on sale when the sale ended.
  unsoldSeats: number;
  soldPct: number;
  revenue: number;
  soldOutAtMs: number | null;
  saleEndedAtMs: number;
  avgWaitMs: number;
  served: number;
  turnedAway: number;
  gaveUp: number;
  expiredHolds: number;
  clashes: number;
  fastest: SectionHighlight | null;
  slowest: SectionHighlight | null;
}

// Everything the end-of-sale card shows, derived from the final stats alone.
export function buildSummary(stats: SimStats): SaleSummary {
  const highlights: SectionHighlight[] = stats.sections.map((section, index) => ({
    index,
    soldOutAtMs: section.soldOutAtMs,
    soldPct: sectionShares(section).sold,
  }));

  const soldOutOnes = highlights.filter((h) => h.soldOutAtMs !== null);
  const fastest = soldOutOnes.reduce<SectionHighlight | null>(
    (best, h) => (best === null || (h.soldOutAtMs ?? 0) < (best.soldOutAtMs ?? 0) ? h : best),
    null,
  );

  // The slowest is a section that never sold out (least sold), else the last one to sell out.
  const neverSoldOut = highlights.filter((h) => h.soldOutAtMs === null);
  const slowest =
    neverSoldOut.length > 0
      ? neverSoldOut.reduce((worst, h) => (h.soldPct < worst.soldPct ? h : worst))
      : soldOutOnes.reduce<SectionHighlight | null>(
          (worst, h) =>
            worst === null || (h.soldOutAtMs ?? 0) > (worst.soldOutAtMs ?? 0) ? h : worst,
          null,
        );

  return {
    seatsSold: stats.seats.sold,
    sellableSeats: stats.seats.total - stats.seats.reserved,
    reservedSeats: stats.seats.reserved,
    unsoldSeats: stats.seats.available + stats.seats.held,
    soldPct: stats.soldPct,
    revenue: stats.revenue,
    soldOutAtMs: stats.soldOutAtMs,
    saleEndedAtMs: stats.simTimeMs,
    avgWaitMs: stats.avgWaitMs,
    served: stats.served,
    turnedAway: stats.turnedAway,
    gaveUp: stats.gaveUp,
    expiredHolds: stats.expiredHolds,
    clashes: stats.clashes,
    fastest,
    slowest,
  };
}
