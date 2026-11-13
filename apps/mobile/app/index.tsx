import { Redirect } from 'expo-router';

import { selectSignedIn, useSessionStore } from '../src/stores/session';

/** Entry point: Home when signed in, Welcome otherwise. */
export default function Index() {
  const signedIn = useSessionStore(selectSignedIn);
  return <Redirect href={signedIn ? '/home' : '/welcome'} />;
}
