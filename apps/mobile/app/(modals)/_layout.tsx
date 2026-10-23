import { Stack } from 'expo-router';

/** Scan flow, expense form and sheets: no bottom nav (DESIGN_HANDOFF.md §4). */
export default function ModalsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
