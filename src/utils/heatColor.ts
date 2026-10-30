// Fill for a section from how fast it is selling, relative to the hottest section right now.
export function heatColor(velocity: number, hottest: number): string {
  if (velocity <= 0 || hottest <= 0) return 'rgba(148, 163, 184, 0.18)';
  const t = Math.min(1, velocity / hottest);
  const hue = 55 - 55 * t;
  return `hsla(${hue}, 95%, 50%, ${0.3 + 0.45 * t})`;
}
