import { Redirect } from 'expo-router';

// No auth gate yet (build step 1): always start on the Home tab.
export default function Index() {
  return <Redirect href="/home" />;
}
