import type { HoldMessage } from '../interfaces/venue.interfaces';
import { HOLD_CHANNEL_NAME, isHoldMessage } from './holdProtocol';

// The minimal surface this module actually uses from BroadcastChannel -
// letting a fake bus stand in for it in tests without needing jsdom (which,
// verified, doesn't implement BroadcastChannel at all) to support it.
export interface BroadcastChannelLike {
  postMessage: (message: unknown) => void;
  close: () => void;
  addEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void;
  removeEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void;
}

export interface HoldChannel {
  post: (message: HoldMessage) => void;
  close: () => void;
  readonly available: boolean;
}

function defaultFactory(name: string): BroadcastChannelLike | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(name);
}

// Wraps BroadcastChannel behind a feature-detected, injectable factory.
// When unavailable (no global, or construction throws - some privacy modes
// do) this returns a no-op channel rather than throwing, so every other
// feature (checkout timer, simulated holds, the resolver) keeps working
// with cross-tab contention simply absent - the correct degradation for an
// enhancement, not a requirement.
export function createHoldChannel(
  sessionId: string,
  onMessage: (message: HoldMessage) => void,
  factory: (name: string) => BroadcastChannelLike | null = defaultFactory,
): HoldChannel {
  let channel: BroadcastChannelLike | null;
  try {
    channel = factory(HOLD_CHANNEL_NAME);
  } catch {
    channel = null;
  }

  if (!channel) {
    return { post: () => undefined, close: () => undefined, available: false };
  }

  const activeChannel = channel;
  const listener = (event: { data: unknown }) => {
    if (!isHoldMessage(event.data)) return;
    // BroadcastChannel never echoes to its own poster, but a fake test bus
    // might - dropping self-originated messages here keeps both honest.
    if (event.data.from === sessionId) return;
    onMessage(event.data);
  };
  activeChannel.addEventListener('message', listener);

  return {
    post: (message) => {
      activeChannel.postMessage(message);
    },
    close: () => {
      activeChannel.removeEventListener('message', listener);
      activeChannel.close();
    },
    available: true,
  };
}
