import { create } from 'zustand';

import type { Receipt, ReceiptPhoto } from '../api/hooks';
import { uuidv4 } from '../lib/uuid';

/**
 * The in-progress receipt scan (AGENTS.md §8: Zustand holds the scan draft). Lives across the
 * camera → review / failed screens; cleared when the scan is saved, discarded or cancelled.
 */
type ScanState = {
  photo: ReceiptPhoto | null;
  /** Upload id for `photo`; reused on retries so the server doesn't create a second receipt. */
  uploadId: string | null;
  receipt: Receipt | null;
  setPhoto: (photo: ReceiptPhoto) => void;
  setReceipt: (receipt: Receipt) => void;
  reset: () => void;
};

export const useScanStore = create<ScanState>((set) => ({
  photo: null,
  uploadId: null,
  receipt: null,
  setPhoto: (photo) => set({ photo, uploadId: uuidv4(), receipt: null }),
  setReceipt: (receipt) => set({ receipt }),
  reset: () => set({ photo: null, uploadId: null, receipt: null }),
}));
