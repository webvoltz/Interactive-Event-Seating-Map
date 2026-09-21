const STORAGE_KEY = 'venue-session-id';

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

let cached: string | null = null;

export function getSessionId(): string {
  if (cached) return cached;

  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      cached = stored;
      return cached;
    }
    const fresh = generateId();
    sessionStorage.setItem(STORAGE_KEY, fresh);
    cached = fresh;
    return fresh;
  } catch {
    // sessionStorage can throw (e.g. Safari private mode); fall back in-memory.
    cached ??= generateId();
    return cached;
  }
}
