import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

/** `loading` until Supabase has read any saved session at startup. */
export type SessionStatus = 'loading' | 'signedIn' | 'signedOut';

type SessionState = {
  status: SessionStatus;
  session: Session | null;
  setSession: (session: Session | null) => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  status: 'loading',
  session: null,
  setSession: (session) => set({ session, status: session ? 'signedIn' : 'signedOut' }),
}));
