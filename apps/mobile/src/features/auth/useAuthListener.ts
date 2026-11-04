import { useEffect } from 'react';

import { supabase } from '../../lib/supabase';
import { useSessionStore } from '../../stores/session';

/**
 * Keeps the session store in sync with Supabase. Supabase sends INITIAL_SESSION (the saved
 * session, or null) right after subscribing, then SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT.
 * Mount once, in the root layout.
 */
export function useAuthListener() {
  const setSession = useSessionStore((s) => s.setSession);

  useEffect(() => {
    if (!supabase) {
      setSession(null);
      return;
    }
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      // Keep this callback synchronous: awaiting other auth calls in here can deadlock.
      setSession(session);
    });
    return () => data.subscription.unsubscribe();
  }, [setSession]);
}
