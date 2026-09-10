import { useVenueStore } from '../store/seatStore';
import { useCountdown } from '../hooks/useCountdown';
import { SELECTION_HOLD_MS } from '../utils/holdProtocol';
import {
  describeCountdownMilestone,
  formatCountdown,
  pickCountdownMilestone,
} from '../utils/formatCountdown';
import Icon from './Icon';

const URGENT_THRESHOLD_MS = 60_000;
const PULSE_THRESHOLD_MS = 30_000;

export default function CheckoutTimer() {
  const selectionExpiresAt = useVenueStore((s) => s.selectionExpiresAt);
  const remaining = useCountdown(selectionExpiresAt);

  if (remaining === null) return null;

  const isUrgent = remaining <= URGENT_THRESHOLD_MS;
  const progressPercent = Math.min(100, Math.max(0, (remaining / SELECTION_HOLD_MS) * 100));

  return (
    <div
      role="timer"
      aria-label="Time left to complete your booking"
      className={`mb-4 rounded-lg border px-3 py-2 ${
        isUrgent ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
          <Icon name="clock" className="w-3.5 h-3.5" />
          Seats held for
        </span>
        {/* The ticking digits are silent to assistive tech - see the
            aria-live sibling below, which announces stable milestone bands
            instead of every second. */}
        <span
          aria-hidden="true"
          className={`font-mono text-sm font-bold ${isUrgent ? 'text-amber-700' : 'text-gray-800'}`}
        >
          {formatCountdown(remaining)}
        </span>
      </div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full rounded-full ${isUrgent ? 'bg-hold-warning' : 'bg-blue-500'} ${
            remaining <= PULSE_THRESHOLD_MS ? 'hold-timer-pulse' : ''
          }`}
          style={{ width: `${progressPercent}%`, transition: 'width 1s linear' }}
        />
      </div>
      <span aria-live="polite" className="sr-only">
        {describeCountdownMilestone(pickCountdownMilestone(remaining))}
      </span>
    </div>
  );
}
