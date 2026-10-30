import type { Venue } from '../interfaces/venue.interfaces';
import venueFile from '../../public/venue.json?raw';

function isVenue(data: unknown): data is Venue {
  return (
    typeof data === 'object' && data !== null && 'sections' in data && Array.isArray(data.sections)
  );
}

// The shipped 15,000-seat venue, for tests that need the real thing.
const parsed: unknown = JSON.parse(venueFile);
if (!isVenue(parsed)) throw new Error('public/venue.json is not a venue');
export const realVenue: Venue = parsed;
