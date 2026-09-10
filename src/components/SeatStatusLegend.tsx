const STATUSES = [
  { key: 'selected', label: 'Selected', swatchClass: 'bg-seat-selected' },
  { key: 'sold', label: 'Sold', swatchClass: 'bg-seat-sold' },
  { key: 'reserved', label: 'Reserved', swatchClass: 'bg-seat-reserved' },
  { key: 'held', label: 'Held', swatchClass: 'bg-seat-held' },
] as const;

export default function SeatStatusLegend() {
  return (
    <div
      role="region"
      aria-label="Seat status legend"
      className="fixed top-4 right-4 z-50 w-56 rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
    >
      <h2 className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-3">Seat Status</h2>
      <div className="grid grid-cols-2 gap-3">
        {STATUSES.map((status) => (
          <div key={status.key} className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-sm ${status.swatchClass}`} />
            <span className="text-xs text-gray-700">{status.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
