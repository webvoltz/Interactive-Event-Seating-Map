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

export interface Booking {
  id: string;
  seatIds: string[];
  total: number;
  createdAt: number;
}

interface VenueState {
  activeSectionId: string | null;
  selectedSeats: Set<string>;
  soldSeats: Set<string>;
  bookings: Booking[];
  viewingBookingId: string | null;
  // null means "fit the whole section"; set by selectSeatBlock/viewBooking, cleared by setActiveSection.
  mapFocusSeatIds: string[] | null;
  zoom: number;
  pan: { x: number; y: number };
  viewTransitionMs: number;
  feedback: Feedback | null;

  // Only ever OTHER tabs' claims - this tab's own is selectedSeats + selectionExpiresAt.
  holds: HoldMap;
  selectionExpiresAt: number | null;
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

// Fields are optional: localStorage may hold data from an older app version.
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
      mapFocusSeatIds: null,
      zoom: 0.4,
      pan: { x: 0, y: 0 },
      viewTransitionMs: 200,
      feedback: null,
      holds: new Map(),
      selectionExpiresAt: null,
      simulationSeeded: false,

      setActiveSection: (id) => set({ activeSectionId: id, mapFocusSeatIds: null }),
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
            selectedSeats: newSelected,
            viewingBookingId: null,
            // Anchored to when the cart opened; adding seats doesn't extend it.
            selectionExpiresAt:
              newSelected.size === 0 ? null : (state.selectionExpiresAt ?? now + SELECTION_HOLD_MS),
          };
        }),

      // One atomic transition, so there's no commit where the seats are
      // selected but their section isn't mounted yet.
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
            mapFocusSeatIds: seatIds,
            selectionExpiresAt: Date.now() + SELECTION_HOLD_MS,
          };
        }),

      clearSelection: () => set({ selectedSeats: new Set(), selectionExpiresAt: null }),

      // Re-validates the deadline inside this same synchronous set() so it can't race the expiry timer.
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

      viewBooking: (id) =>
        set((state) => {
          const booking = state.bookings.find((b) => b.id === id);
          return { viewingBookingId: id, mapFocusSeatIds: booking ? booking.seatIds : null };
        }),
      clearViewingBooking: () => set({ viewingBookingId: null, mapFocusSeatIds: null }),

      clearFeedback: () => set({ feedback: null }),
      setFeedback: (feedback) => set({ feedback }),

      setHolds: (holds) => set({ holds }),

      // Guarded so a late cross-tab `state` reply can't clobber the seeding that already happened.
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

      // Skips the set() entirely when nothing changed, so a no-op tick costs no re-render.
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
