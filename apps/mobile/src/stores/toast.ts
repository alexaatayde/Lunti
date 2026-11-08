import { create } from 'zustand';

/**
 * App-wide toast (AGENTS.md §8: "Transaction saved. Budget updated." / deleted + Undo).
 * Lives outside screens so it stays visible after a form closes and the list reappears.
 */
export type ToastState = {
  id: number;
  message: string | null;
  onUndo?: () => void;
  show: (message: string, options?: { onUndo?: () => void }) => void;
  hide: () => void;
};

export const useToastStore = create<ToastState>((set) => ({
  id: 0,
  message: null,
  onUndo: undefined,
  show: (message, options) =>
    set((s) => ({ id: s.id + 1, message, onUndo: options?.onUndo })),
  hide: () => set({ message: null, onUndo: undefined }),
}));

export const showToast = (message: string, options?: { onUndo?: () => void }) =>
  useToastStore.getState().show(message, options);
