import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PersistStorage, StorageValue } from 'zustand/middleware';

export const MAX_SELECTABLE_SEATS = 8;

interface Feedback {
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
  feedback: Feedback | null;
  setActiveSection: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  toggleSeat: (seatId: string) => void;
  clearSelection: () => void;
  confirmPurchase: (total: number) => void;
  viewBooking: (id: string) => void;
  clearViewingBooking: () => void;
  clearFeedback: () => void;
}

type PersistedVenueState = Pick<VenueState, 'selectedSeats' | 'soldSeats' | 'bookings'>;

interface SerializedVenueState {
  selectedSeats: string[];
  soldSeats: string[];
  bookings: Booking[];
}

const venueStorage: PersistStorage<PersistedVenueState> = {
  getItem: (name) => {
    const str = localStorage.getItem(name);
    if (!str) return null;
    const { state, version } = JSON.parse(str) as StorageValue<SerializedVenueState>;
    return {
      state: {
        selectedSeats: new Set(state.selectedSeats),
        soldSeats: new Set(state.soldSeats ?? []),
        bookings: state.bookings ?? [],
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
      },
      ...(value.version !== undefined && { version: value.version }),
    };
    localStorage.setItem(name, JSON.stringify(serialized));
  },
  removeItem: (name) => localStorage.removeItem(name),
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
      feedback: null,
      setActiveSection: (id) => set({ activeSectionId: id }),
      setZoom: (zoom) => set({ zoom }),

      toggleSeat: (seatId) =>
        set((state) => {
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
          // Starting/editing a live selection supersedes browsing past
          // booking history - drop any "viewing" highlight so the two
          // sidebar modes never fight over what the map should show.
          return { selectedSeats: newSelected, viewingBookingId: null };
        }),

      clearSelection: () => set({ selectedSeats: new Set() }),

      // The "checkout" transition: move whatever is currently selected into
      // soldSeats (permanently unavailable in this browser), record it as
      // one Booking (so history can show/highlight it as a unit), and empty
      // the cart - as opposed to clearSelection(), which just abandons the
      // cart without a sale.
      confirmPurchase: (total) =>
        set((state) => {
          const seatIds = Array.from(state.selectedSeats);
          const newBooking: Booking = {
            id: `BK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            seatIds,
            total,
            createdAt: Date.now(),
          };
          return {
            soldSeats: new Set([...state.soldSeats, ...state.selectedSeats]),
            selectedSeats: new Set(),
            bookings: [newBooking, ...state.bookings],
            viewingBookingId: newBooking.id,
          };
        }),

      viewBooking: (id) => set({ viewingBookingId: id }),
      clearViewingBooking: () => set({ viewingBookingId: null }),

      clearFeedback: () => set({ feedback: null }),
    }),
    {
      name: 'venue-storage',
      storage: venueStorage,
      partialize: (state) => ({
        selectedSeats: state.selectedSeats,
        soldSeats: state.soldSeats,
        bookings: state.bookings,
      }),
    },
  ),
);
