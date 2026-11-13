/**
 * Lets the auth listener tell a sign-out the app asked for (Sign out button, finishing a
 * password reset) from one Supabase did on its own because the session can no longer be
 * refreshed. Only the second shows "Your session ended. Please sign in again."
 */
let intended = 0;

/** Runs `signOut` with the resulting SIGNED_OUT event marked as intended. */
export async function intendedSignOut<T>(signOut: () => Promise<T>): Promise<T> {
  intended += 1;
  try {
    return await signOut();
  } finally {
    intended -= 1;
  }
}

export function isSignOutIntended() {
  return intended > 0;
}
