import { useEffect } from 'react';
import { useVenueStore } from '../store/seatStore';

const AUTO_DISMISS_MS = 4000;

export default function Toast() {
  const feedback = useVenueStore((s) => s.feedback);
  const clearFeedback = useVenueStore((s) => s.clearFeedback);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(clearFeedback, AUTO_DISMISS_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [feedback, clearFeedback]);

  if (!feedback) return null;

  const isError = feedback.type === 'error';

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-[70] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 md:left-auto md:right-8 md:translate-x-0"
    >
      <div
        className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 shadow-lg ${
          isError ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'
        }`}
      >
        <p className="text-sm font-medium">{feedback.message}</p>
        <button
          type="button"
          onClick={clearFeedback}
          aria-label="Dismiss"
          className="cursor-pointer text-white/80 hover:text-white"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
