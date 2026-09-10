import type { BroadcastChannelLike } from '../utils/holdChannel';

// A minimal, synchronous stand-in for BroadcastChannel: every channel on the
// same bus receives every other channel's postMessage, but never its own -
// exactly the semantics holdChannel.ts and useHoldSync.ts rely on. jsdom
// doesn't implement BroadcastChannel at all, so real two-tab scenarios are
// driven deterministically through this instead.
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
