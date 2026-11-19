import { create } from 'zustand';

interface SuspendedState {
  open: boolean;
  show: () => void;
  close: () => void;
}

/** Drives the "read-only mode" modal, opened when a write is refused with SUBSCRIPTION_SUSPENDED. */
export const useSuspendedStore = create<SuspendedState>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));
