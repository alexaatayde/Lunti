/**
 * Push registration (AGENTS.md §2: FCM via the expo-notifications device token). The app sends
 * only its device token to the API; Firebase credentials live on the server.
 *
 * Push needs a development/EAS build with Firebase configured (google-services.json). In Expo
 * Go (Android, SDK 53+) or without permission there is no token: registration is skipped
 * quietly and notifications still appear on the Notifications screen.
 */
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { registerDevice, unregisterDevice } from '../../api/hooks';

// AndroidImportance.HIGH (re-exported through a type module the import linter can't follow).
const ANDROID_IMPORTANCE_HIGH = 6;

let registeredToken: string | null = null;

export async function registerForPush(): Promise<string | null> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
  try {
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (!permission.granted) return null;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Lunti',
        importance: ANDROID_IMPORTANCE_HIGH,
      });
    }
    const token = await Notifications.getDevicePushTokenAsync();
    const value = typeof token.data === 'string' ? token.data : null;
    if (!value) return null;
    await registerDevice(value, Platform.OS);
    registeredToken = value;
    return value;
  } catch {
    return null; // Expo Go, no Firebase config, offline: in-app notifications only
  }
}

/** Best effort on sign-out, so this phone stops getting the account's pushes. */
export async function unregisterFromPush(): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;
  try {
    await unregisterDevice(token);
  } catch {
    // Offline: the server drops the token when FCM reports it dead, or the next account
    // that signs in on this phone claims it.
  }
}

/** Registers once per sign-in and opens the notification's screen when one is tapped. */
export function usePushNotifications(signedIn: boolean) {
  useEffect(() => {
    if (signedIn) void registerForPush();
  }, [signedIn]);

  useEffect(() => {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const link = response.notification.request.content.data?.deep_link;
      if (typeof link === 'string' && link.startsWith('/')) router.push(link as Href);
    });
    return () => sub.remove();
  }, []);
}
