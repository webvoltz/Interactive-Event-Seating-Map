import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'venue-session-id';

// getSessionId() caches in a module-level variable, so each test needs a
// fresh module instance (via resetModules + a dynamic import) to observe
// its cold-start behavior rather than a previous test's cached id.
describe('getSessionId', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules();
  });

  it('returns the same id on a second call in the same session', async () => {
    const { getSessionId } = await import('./sessionId');
    expect(getSessionId()).toBe(getSessionId());
  });

  it('reuses an id already present in sessionStorage', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'existing-id');
    const { getSessionId } = await import('./sessionId');
    expect(getSessionId()).toBe('existing-id');
  });

  it('persists a freshly generated id to sessionStorage', async () => {
    const { getSessionId } = await import('./sessionId');
    const id = getSessionId();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(id);
  });

  it('falls back to a manually generated id when crypto.randomUUID is unavailable', async () => {
    const originalRandomUUID = crypto.randomUUID.bind(crypto);
    // @ts-expect-error deliberately simulating an older browser without crypto.randomUUID
    delete crypto.randomUUID;
    try {
      const { getSessionId } = await import('./sessionId');
      const id = getSessionId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    } finally {
      crypto.randomUUID = originalRandomUUID;
    }
  });

  it('falls back to an in-memory id when sessionStorage throws', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: {
        getItem() {
          throw new Error('blocked');
        },
        setItem() {
          throw new Error('blocked');
        },
      },
    });
    try {
      const { getSessionId } = await import('./sessionId');
      const id = getSessionId();
      expect(typeof id).toBe('string');
      // Still cached in-memory even though persistence failed.
      expect(getSessionId()).toBe(id);
    } finally {
      if (original) Object.defineProperty(window, 'sessionStorage', original);
    }
  });
});
