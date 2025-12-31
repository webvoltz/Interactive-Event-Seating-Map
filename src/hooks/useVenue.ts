import { useEffect, useState } from "react";
import type { Venue } from "../interfaces/venue.interfaces";

export function useVenue() {
    const [venue, setVenue] = useState<Venue | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchVenue();
    }, []);

    const fetchVenue = async () => {
        try {
            const response = await fetch('/venue.json');
            const data = await response.json();
            setVenue(data);
            setLoading(false);
        } catch (error) {
            setError('Failed to load venue data');
            setLoading(false);
        }
    };

    return { venue, loading, error };
}