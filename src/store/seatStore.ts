import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import type { HoldMap } from '../interfaces/venue.interfaces';
import { SELECTION_HOLD_MS, pruneHolds } from '../utils/holdProtocol';

export const MAX_SELECTABLE_SEATS = 8;

export interface Feedback {
  type: 'info' | 'error';
  message: string;
}

// A completed purchase, grouping the seats bought together in one checkout
// so booking history can show/highlight them as one unit rather than as
// loose entries in the flat soldSeats set.
export interface Booking {
  id: string;
  seatIds: string[];
  total: number;
  createdAt: number;
}

interface VenueState {
  activeSectionId: string | null;
  selectedSeats: Set<string>;
  // Seats bought via confirmPurchase(). There's no backend, so "sold" only
  // means "sold in this browser" - it's a local, honest stand-in for a real
  // server-side sale record, not a claim about the venue's actual inventory.
  soldSeats: Set<string>;
  bookings: Booking[];
  // Which past booking's seats should currently be highlighted on the map,
  // if any - set when a booking-history entry is clicked, distinct from the
  // active seat *selection* (selectedSeats) which drives the checkout flow.
  viewingBookingId: string | null;
  zoom: number;
  pan: { x: number; y: number };
  viewTransitionMs: number;
  feedback: Feedback | null;

  // Live seat-hold contention (see docs/engineering-notes.md). `holds` only
  // ever contains OTHER claims - a foreign tab's live cart, or a seeded demo
  // hold - never this tab's own, which is `selectedSeats` +
  // `selectionExpiresAt` instead. Deliberately not persisted: it's
  // time-based (a stale hold from last session is meaningless) and shared
  // cross-tab state, so localStorage-as-source-of-truth would fight the
  // BroadcastChannel sync that actually owns it.
  holds: HoldMap;
  // This tab's own checkout deadline. Persisted alongside selectedSeats so
  // a reload doesn't grant an unbounded hold - see useHoldExpiry, which
  // clears an already-lapsed one on boot.
  selectionExpiresAt: number | null;
  // Whether the runtime demo simulation has seeded (or adopted, from an
  // incumbent tab) its holds yet - guards against re-seeding after a late
  // cross-tab `state` reply. Not persisted: every fresh load re-seeds.
  simulationSeeded: boolean;

  setActiveSection: (id: string | null) => void;
  setPan: (pan: { x: number; y: number }) => void;
  setView: (zoom: number, pan: { x: number; y: number }, transitionMs: number) => void;
  toggleSeat: (seatId: string) => void;
  selectSeatBlock: (seatIds: string[], sectionId: string) => void;
  clearSelection: () => void;
  confirmPurchase: (total: number) => Booking | null;
  viewBooking: (id: string) => void;
  clearViewingBooking: () => void;
  clearFeedback: () => void;
  setFeedback: (feedback: Feedback) => void;

  setHolds: (holds: HoldMap) => void;
  seedSimulation: (holds: HoldMap) => void;
  applyRemoteSold: (seatIds: string[]) => void;
  releaseLostSeats: (seatIds: string[]) => void;
  runExpiry: (now: number) => void;
}

type PersistedVenueState = Pick<
  VenueState,
  'selectedSeats' | 'soldSeats' | 'bookings' | 'selectionExpiresAt'
>;

// Optional, not just for the type checker's sake: this is deserializing
// localStorage, which could hold data from an older app version (written
// before `bookings`/`selectionExpiresAt` existed) or something a user
// edited by hand in DevTools - genuinely nothing guarantees these fields
// are present.
interface SerializedVenueState {
  selectedSeats?: string[];
  soldSeats?: string[];
  bookings?: Booking[];
  selectionExpiresAt?: number | null;
}

function isPersistedStorageValue(data: unknown): data is StorageValue<SerializedVenueState> {
  return (
    typeof data === 'object' &&
    data !== null &&
    'state' in data &&
    typeof data.state === 'object' &&
    data.state !== null
  );
}

const venueStorage: PersistStorage<PersistedVenueState> = {
  getItem: (name) => {
    const str = localStorage.getItem(name);
    if (!str) return null;
    const parsed: unknown = JSON.parse(str);
    if (!isPersistedStorageValue(parsed)) return null;
    const { state, version } = parsed;
    return {
      state: {
        selectedSeats: new Set(state.selectedSeats ?? []),
        soldSeats: new Set(state.soldSeats ?? []),
        bookings: state.bookings ?? [],
        selectionExpiresAt:
          typeof state.selectionExpiresAt === 'number' ? state.selectionExpiresAt : null,
      },
      ...(version !== undefined && { version }),
    };
  },
  setItem: (name, value) => {
    const serialized: StorageValue<SerializedVenueState> = {
      state: {
        selectedSeats: Array.from(value.state.selectedSeats),
        soldSeats: Array.from(value.state.soldSeats),
        bookings: value.state.bookings,
        selectionExpiresAt: value.state.selectionExpiresAt,
      },
      ...(value.version !== undefined && { version: value.version }),
    };
    localStorage.setItem(name, JSON.stringify(serialized));
  },
  removeItem: (name) => {
    localStorage.removeItem(name);
  },
};

export const useVenueStore = create<VenueState>()(
  persist(
    (set) => ({
      activeSectionId: null,
      selectedSeats: new Set(),
      soldSeats: new Set(),
      bookings: [],
      viewingBookingId: null,
      zoom: 0.4,
      pan: { x: 0, y: 0 },
      viewTransitionMs: 200,
      feedback: null,
      holds: new Map(),
      selectionExpiresAt: null,
      simulationSeeded: false,

      setActiveSection: (id) => set({ activeSectionId: id }),
      setPan: (pan) => set({ pan }),
      setView: (zoom, pan, transitionMs) => set({ zoom, pan, viewTransitionMs: transitionMs }),

      toggleSeat: (seatId) =>
        set((state) => {
          const now = Date.now();
          const liveHold = state.holds.get(seatId);
          if (liveHold && liveHold.expiresAt > now) {
            return { feedback: { type: 'error', message: 'That seat was just taken.' } };
          }

          const newSelected = new Set(state.selectedSeats);
          if (newSelected.has(seatId)) {
            newSelected.delete(seatId);
          } else {
            if (newSelected.size >= MAX_SELECTABLE_SEATS) {
              return {
                feedback: {
                  type: 'error',
                  message: `You can select a maximum of ${MAX_SELECTABLE_SEATS} seats.`,
                },
              };
            }
            newSelected.add(seatId);
          }

          return {
            // Starting/editing a live selection supersedes browsing past
            // booking history - drop any "viewing" highlight so the two
            // sidebar modes never fight over what the map should show.
            selectedSeats: newSelected,
            viewingBookingId: null,
            // The first seat starts a fresh 5-minute clock; adding more
            // seats does NOT extend it (real ticketing sites don't) - the
            // deadline is anchored to when the cart was opened, not to its
            // last edit. Going back to zero clears it.
            selectionExpiresAt:
              newSelected.size === 0 ? null : (state.selectionExpiresAt ?? now + SELECTION_HOLD_MS),
          };
        }),

      // A whole contiguous block (from the best-seats finder) arrives as one
      // unit, so it's one atomic transition - toggleSeat() can't express
      // this without tripping the MAX_SELECTABLE_SEATS check partway
      // through and firing one feedback per seat. Setting activeSectionId
      // in the same update (rather than a separate setActiveSection call)
      // means there's no intermediate commit where the seats are selected
      // but their section isn't the mounted one yet.
      selectSeatBlock: (seatIds, sectionId) =>
        set(() => {
          if (seatIds.length === 0 || seatIds.length > MAX_SELECTABLE_SEATS) {
            return {
              feedback: {
                type: 'error',
                message: `You can select a maximum of ${MAX_SELECTABLE_SEATS} seats.`,
              },
            };
          }
          return {
            selectedSeats: new Set(seatIds),
            activeSectionId: sectionId,
            viewingBookingId: null,
            selectionExpiresAt: Date.now() + SELECTION_HOLD_MS,
          };
        }),

      clearSelection: () => set({ selectedSeats: new Set(), selectionExpiresAt: null }),

      // The "checkout" transition: move whatever is currently selected into
      // soldSeats (permanently unavailable in this browser), record it as
      // one Booking (so history can show/highlight it as a unit), and empty
      // the cart - as opposed to clearSelection(), which just abandons the
      // cart without a sale. Re-validates the checkout deadline inside this
      // same synchronous set() (JS is single-threaded, so this can't
      // interleave with the expiry timer) rather than trusting the caller's
      // belief that the hold was still live.
      confirmPurchase: (total) => {
        let result: Booking | null = null;
        set((state) => {
          const now = Date.now();
          if (state.selectionExpiresAt !== null && state.selectionExpiresAt <= now) {
            result = null;
            return {
              selectedSeats: new Set(),
              selectionExpiresAt: null,
              feedback: {
                type: 'error',
                message:
                  'Your hold expired before payment completed. Please select your seats again.',
              },
            };
          }

          const seatIds = Array.from(state.selectedSeats);
          const newBooking: Booking = {
            id: `BK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            seatIds,
            total,
            createdAt: Date.now(),
          };
          result = newBooking;
          return {
            soldSeats: new Set([...state.soldSeats, ...state.selectedSeats]),
            selectedSeats: new Set(),
            selectionExpiresAt: null,
            bookings: [newBooking, ...state.bookings],
            viewingBookingId: newBooking.id,
          };
        });
        return result;
      },

      viewBooking: (id) => set({ viewingBookingId: id }),
      clearViewingBooking: () => set({ viewingBookingId: null }),

      clearFeedback: () => set({ feedback: null }),
      setFeedback: (feedback) => set({ feedback }),

      setHolds: (holds) => set({ holds }),

      // Guarded so a late cross-tab `state` reply (after this tab already
      // seeded its own simulation while waiting one out) can't clobber
      // whichever seeding happened first.
      seedSimulation: (holds) =>
        set((state) => (state.simulationSeeded ? {} : { holds, simulationSeeded: true })),

      applyRemoteSold: (seatIds) =>
        set((state) => {
          if (seatIds.length === 0) return {};
          const soldSet = new Set(state.soldSeats);
          const nextHolds = new Map(state.holds);
          const nextSelected = new Set(state.selectedSeats);
          let selectionChanged = false;
          for (const id of seatIds) {
            soldSet.add(id);
            nextHolds.delete(id);
            if (nextSelected.delete(id)) selectionChanged = true;
          }
          return {
            soldSeats: soldSet,
            holds: nextHolds,
            selectedSeats: nextSelected,
            selectionExpiresAt:
              selectionChanged && nextSelected.size === 0 ? null : state.selectionExpiresAt,
          };
        }),

      // A peer's claim won a tie-break on one or more of my own selected
      // seats - drop just those, not the whole cart.
      releaseLostSeats: (seatIds) =>
        set((state) => {
          if (seatIds.length === 0) return {};
          const next = new Set(state.selectedSeats);
          seatIds.forEach((id) => next.delete(id));
          return {
            selectedSeats: next,
            selectionExpiresAt: next.size === 0 ? null : state.selectionExpiresAt,
            feedback: {
              type: 'error',
              message:
                seatIds.length === 1
                  ? 'A seat you selected was taken in another tab.'
                  : 'Some seats you selected were taken in another tab.',
            },
          };
        }),

      // Prunes lapsed holds and, separately, releases this tab's own
      // selection if ITS deadline has passed - one set() call either way.
      // Returns without touching `holds`'s reference (and skips the whole
      // set() when nothing changed at all) so a tick that finds nothing
      // expired costs no re-render of the ~1,500 mounted seats.
      runExpiry: (now) =>
        set((state) => {
          const prunedHolds = pruneHolds(state.holds, now);
          const selectionExpired =
            state.selectionExpiresAt !== null && state.selectionExpiresAt <= now;

          if (prunedHolds === state.holds && !selectionExpired) return {};

          return {
            ...(prunedHolds !== state.holds && { holds: prunedHolds }),
            ...(selectionExpired && {
              selectedSeats: new Set<string>(),
              selectionExpiresAt: null,
              feedback: {
                type: 'info' as const,
                message: 'Your seat hold expired. Please select your seats again.',
              },
            }),
          };
        }),
    }),
    {
      name: 'venue-storage',
      storage: venueStorage,
      partialize: (state) => ({
        selectedSeats: state.selectedSeats,
        soldSeats: state.soldSeats,
        bookings: state.bookings,
        selectionExpiresAt: state.selectionExpiresAt,
      }),
    },
  ),
);
