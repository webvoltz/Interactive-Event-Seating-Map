export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export type CountdownMilestone = 'start' | '2min' | '1min' | '30s' | '10s' | 'expired';

// Bands, not exact seconds - this is what keeps an aria-live announcement of
// the milestone from firing every tick. The band a given remaining time
// falls into is stable across an entire minute-or-more range, so the
// announced text is byte-identical for most of a session and only changes
// six times over a five-minute hold.
export function pickCountdownMilestone(remainingMs: number): CountdownMilestone {
  const totalSeconds = Math.ceil(remainingMs / 1000);
  if (totalSeconds <= 0) return 'expired';
  if (totalSeconds <= 10) return '10s';
  if (totalSeconds <= 30) return '30s';
  if (totalSeconds <= 60) return '1min';
  if (totalSeconds <= 120) return '2min';
  return 'start';
}

export function describeCountdownMilestone(milestone: CountdownMilestone): string {
  switch (milestone) {
    case 'start':
      return 'Your seats are held for 5 minutes to complete checkout.';
    case '2min':
      return '2 minutes left to complete your booking.';
    case '1min':
      return '1 minute left to complete your booking.';
    case '30s':
      return '30 seconds left to complete your booking.';
    case '10s':
      return '10 seconds left to complete your booking.';
    case 'expired':
      return 'Your seat hold expired.';
  }
}
