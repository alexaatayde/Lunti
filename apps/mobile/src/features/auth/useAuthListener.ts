import { useEffect } from 'react';

import { supabase } from '../../lib/supabase';
import { useSessionStore } from '../../stores/session';
import { releasePushToken } from '../notifications/push';
import { isSignOutIntended } from './signOutIntent';

/**
 * Keeps the session store in sync with Supabase. Supabase sends INITIAL_SESSION (the saved
 * session, or null) right after subscribing, then SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT /
 * PASSWORD_RECOVERY. Mount once, in the root layout.
 *
 * A SIGNED_OUT nobody asked for means Supabase refused to refresh the session (revoked,
 * expired, signed out elsewhere): the user is told why they are back on Welcome. A temporary
 * network failure never gets here — Supabase keeps the session when a refresh can't connect.
 * The phone's push token is retired too, so the ended account's notifications stop arriving.
 */
export function useAuthListener() {
  useEffect(() => {
    const store = useSessionStore.getState;
    if (!supabase) {
      store().setSession(null);
      return;
    }
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Keep this callback synchronous: awaiting other auth calls in here can deadlock.
      const { status, setNotice, setRecovering, setSession } = store();
      if (event === 'SIGNED_OUT') {
        if (status !== 'signedOut' && !isSignOutIntended()) {
          setNotice('sessionEnded');
          // The server still has this phone's push token for the account: retire it here.
          void releasePushToken();
        }
        setRecovering(false);
      } else if (event === 'PASSWORD_RECOVERY') {
        setRecovering(true);
      } else if (event === 'SIGNED_IN' && session) {
        setNotice(null);
      }
      setSession(session);
    });
    return () => data.subscription.unsubscribe();
  }, []);
}
