import type { BroadcastChannelLike } from '../utils/holdChannel';

// Synchronous BroadcastChannel stand-in (jsdom has no real one): every
// channel receives every other channel's postMessage, never its own.
export function createFakeBus() {
  const channels = new Set<{
    listeners: Set<(event: { data: unknown }) => void>;
    post: (message: unknown) => void;
  }>();

  const factory = (): BroadcastChannelLike => {
    const listeners = new Set<(event: { data: unknown }) => void>();
    const self = {
      listeners,
      post: (message: unknown) => {
        listeners.forEach((listener) => {
          listener({ data: message });
        });
      },
    };
    channels.add(self);

    return {
      postMessage: (message) => {
        channels.forEach((channel) => {
          if (channel !== self) channel.post(message);
        });
      },
      close: () => {
        channels.delete(self);
      },
      addEventListener: (_type, listener) => {
        listeners.add(listener);
      },
      removeEventListener: (_type, listener) => {
        listeners.delete(listener);
      },
    };
  };

  return { factory, channels };
}
