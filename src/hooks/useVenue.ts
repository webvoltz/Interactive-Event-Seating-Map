import { useCallback, useEffect, useState } from 'react';
import type { Venue } from '../interfaces/venue.interfaces';

// A minimal structural check on the fetched JSON before it's trusted as a
// `Venue` - not a full per-seat schema (15,000 seats would make that slow
// for little benefit), just enough to catch the realistic failure modes for
// a static file: wrong file, an error page parsed as JSON, or a completely
// different shape.
function isVenue(data: unknown): data is Venue {
  return (
    typeof data === 'object' &&
    data !== null &&
    'venueId' in data &&
    'name' in data &&
    'sections' in data &&
    typeof data.venueId === 'string' &&
    typeof data.name === 'string' &&
    Array.isArray(data.sections)
  );
}

export function useVenue() {
  const [venue, setVenue] = useState<Venue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    setRetryToken((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchVenue = async () => {
      try {
        const response = await fetch('/venue.json');
        const data: unknown = await response.json();
        if (cancelled) return;
        if (!isVenue(data)) {
          setError('Failed to load venue data');
          setLoading(false);
          return;
        }
        setVenue(data);
        setLoading(false);
      } catch {
        if (cancelled) return;
        setError('Failed to load venue data');
        setLoading(false);
      }
    };

    void fetchVenue();

    return () => {
      cancelled = true;
    };
  }, [retryToken]);

  return { venue, loading, error, refetch };
}
