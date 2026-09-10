const STORAGE_KEY = 'venue-session-id';

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

let cached: string | null = null;

// Per-tab identity for the hold protocol. Deliberately sessionStorage (not
// localStorage, not zustand's persist middleware): it survives a reload
// but is never shared across tabs, so a reloading tab reclaims its OWN
// prior holds instead of colliding with itself as a "new" peer.
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
    // Safari private mode (and similar) can throw on sessionStorage access.
    // Falling back to an in-memory id keeps the tab working as a
    // single-session peer instead of crashing.
    cached ??= generateId();
    return cached;
  }
}
