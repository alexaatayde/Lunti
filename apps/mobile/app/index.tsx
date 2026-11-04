import { Redirect } from 'expo-router';

import { useSessionStore } from '../src/stores/session';

/** Entry point: Home when signed in, Welcome otherwise. */
export default function Index() {
  const signedIn = useSessionStore((s) => s.status === 'signedIn');
  return <Redirect href={signedIn ? '/home' : '/welcome'} />;
}
