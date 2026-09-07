import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PersistStorage, StorageValue } from 'zustand/middleware';

interface VenueState {
  activeSectionId: string | null;
  selectedSeats: Set<string>;
  zoom: number;
  setActiveSection: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  toggleSeat: (seatId: string) => void;
  clearSelection: () => void;
}

type PersistedVenueState = Pick<VenueState, 'selectedSeats'>;

interface SerializedVenueState {
  selectedSeats: string[];
}

const venueStorage: PersistStorage<PersistedVenueState> = {
  getItem: (name) => {
    const str = localStorage.getItem(name);
    if (!str) return null;
    const { state, version } = JSON.parse(str) as StorageValue<SerializedVenueState>;
    return {
      state: { selectedSeats: new Set(state.selectedSeats) },
      ...(version !== undefined && { version }),
    };
  },
  setItem: (name, value) => {
    const serialized: StorageValue<SerializedVenueState> = {
      state: { selectedSeats: Array.from(value.state.selectedSeats) },
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
      zoom: 0.4,
      setActiveSection: (id) => set({ activeSectionId: id }),
      setZoom: (zoom) => set({ zoom }),

      toggleSeat: (seatId) =>
        set((state) => {
          const newSelected = new Set(state.selectedSeats);
          if (newSelected.has(seatId)) {
            newSelected.delete(seatId);
          } else {
            if (newSelected.size >= 8) {
              alert('You can select a maximum of 8 seats.');
              return state;
            }
            newSelected.add(seatId);
          }
          return { selectedSeats: newSelected };
        }),

      clearSelection: () => set({ selectedSeats: new Set() }),
    }),
    {
      name: 'venue-storage',
      storage: venueStorage,
      partialize: (state) => ({ selectedSeats: state.selectedSeats }),
    },
  ),
);
