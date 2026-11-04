import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black,
  useFonts,
} from '@expo-google-fonts/inter';
import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { useAuthListener } from '../src/features/auth/useAuthListener';
import { SetupRequired } from '../src/features/auth/SetupRequired';
import { isSupabaseConfigured } from '../src/lib/supabase';
import { useSessionStore } from '../src/stores/session';
import { colors } from '../src/theme';

// Keep the native splash up until fonts and the saved session have loaded.
SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  // Deep links into stack screens keep the tabs underneath, so Back lands on a tab.
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
  });
  useAuthListener();
  const status = useSessionStore((s) => s.status);

  // If fonts fail to load, carry on with the system font rather than a blank app.
  const ready = (fontsLoaded || !!fontError) && status !== 'loading';

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;
  if (!isSupabaseConfigured) return <SetupRequired />;

  const signedIn = status === 'signedIn';

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        {/* Every app screen must be listed here: Expo Router leaves unlisted routes public. */}
        <Stack.Protected guard={signedIn} redirectTo="/welcome">
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(modals)" options={{ presentation: 'modal' }} />
          <Stack.Screen name="budget/new" options={{ presentation: 'modal' }} />
          <Stack.Screen name="notifications" options={{ presentation: 'modal' }} />
          <Stack.Screen name="profile" />
          <Stack.Screen name="transactions/[id]" />
          <Stack.Screen name="meals/pantry" />
          <Stack.Screen name="meals/grocery-list" />
          <Stack.Screen name="dev/components" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn} redirectTo="/home">
          <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
        </Stack.Protected>
        {/* index only redirects, based on the session. */}
        <Stack.Screen name="index" />
      </Stack>
    </>
  );
}
