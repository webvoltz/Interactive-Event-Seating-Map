import { useEffect, useState } from 'react';
import type { Venue } from '../interfaces/venue.interfaces';

export function useVenue() {
  const [venue, setVenue] = useState<Venue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  return { venue, loading, error };
}
