import { useCallback, useEffect, useState } from 'react';
import type { Venue } from '../interfaces/venue.interfaces';

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
        const data = (await response.json()) as Venue;
        if (cancelled) return;
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
