import type { HoldMessage } from '../interfaces/venue.interfaces';
import { HOLD_CHANNEL_NAME, isHoldMessage } from './holdProtocol';

// Minimal surface used from BroadcastChannel, so tests can supply a fake (jsdom has none).
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
