import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

/** `loading` until Supabase has read any saved session at startup. */
export type SessionStatus = 'loading' | 'signedIn' | 'signedOut';

/** Shown on Welcome / Sign in after a sign-out the user didn't ask for. */
export type SessionNotice = 'sessionEnded';

type SessionState = {
  status: SessionStatus;
  session: Session | null;
  /** Why the user is looking at the sign-in screens, if it wasn't their choice. */
  notice: SessionNotice | null;
  /**
   * A password-reset link opened a temporary session. It only lets the user choose a new
   * password: the app's signed-in screens stay closed until they sign in normally.
   */
  recovering: boolean;
  setSession: (session: Session | null) => void;
  setNotice: (notice: SessionNotice | null) => void;
  setRecovering: (recovering: boolean) => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  status: 'loading',
  session: null,
  notice: null,
  recovering: false,
  setSession: (session) => set({ session, status: session ? 'signedIn' : 'signedOut' }),
  setNotice: (notice) => set({ notice }),
  setRecovering: (recovering) => set({ recovering }),
}));

/** Signed in for normal use (not just holding a password-reset session). */
export const selectSignedIn = (s: SessionState) => s.status === 'signedIn' && !s.recovering;
