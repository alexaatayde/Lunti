/**
 * Push registration (AGENTS.md §2: FCM via the expo-notifications device token). The app sends
 * only its device token to the API; Firebase credentials live on the server.
 *
 * Push needs a development/EAS build with Firebase configured (google-services.json). Expo Go
 * has no FCM push (none at all on Android since SDK 53), and Expo Go 58 lacks native modules
 * that expo-notifications loads at import time ('ExpoApplication', 'ExpoTopicSubscriptionModule'),
 * so importing it there crashed the app on launch. The module is therefore loaded lazily and
 * never in Expo Go. Expo Go is detected with `isRunningInExpoGo()` (its own native module):
 * Expo Go 58 reports `executionEnvironment: 'bare'`, so expo-constants can't tell. In any other
 * build a missing native module disables push with a warning instead of crashing. In-app
 * notifications (the Notifications screen) do not depend on this file.
 */
import { isRunningInExpoGo } from 'expo';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { registerDevice, unregisterDevice } from '../../api/hooks';

type NotificationsModule = typeof import('expo-notifications');

// AndroidImportance.HIGH (re-exported through a type module the import linter can't follow).
const ANDROID_IMPORTANCE_HIGH = 6;

const MISSING_NATIVE_MODULE = /native module/i;

let registeredToken: string | null = null;
let loaded: { module: NotificationsModule | null } | null = null;

/** Whether this runtime can receive FCM push at all (checked before loading native code). */
export function pushSupported(): boolean {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
  return !isRunningInExpoGo();
}

/**
 * expo-notifications, or null where push is unsupported or its native code is missing.
 * Only a missing native module is tolerated; any other error is a real bug and is rethrown.
 */
export function loadNotifications(): NotificationsModule | null {
  if (loaded) return loaded.module;
  if (!pushSupported()) {
    loaded = { module: null };
    return null;
  }
  let module: NotificationsModule | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    module = require('expo-notifications') as NotificationsModule | undefined;
  } catch (error) {
    if (!(error instanceof Error) || !MISSING_NATIVE_MODULE.test(error.message)) throw error;
    return disable(error.message);
  }
  // Metro (dev) reports a module that failed to initialise and then hands back nothing.
  if (typeof module?.getPermissionsAsync !== 'function') return disable('module failed to load');
  loaded = { module };
  return module;
}

/** Warns (so a misconfigured build does not lose push silently) and caches "no push". */
function disable(reason: string): null {
  console.warn(`Push notifications disabled: ${reason}`);
  loaded = { module: null };
  return null;
}

/** Test hook: forget the cached module and token. */
export function resetPushForTests(): void {
  loaded = null;
  registeredToken = null;
}

export async function registerForPush(): Promise<string | null> {
  const os = Platform.OS;
  const Notifications = loadNotifications();
  if (!Notifications || (os !== 'android' && os !== 'ios')) return null;
  try {
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (!permission.granted) return null;
    if (os === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Lunti',
        importance: ANDROID_IMPORTANCE_HIGH,
      });
    }
    const token = await Notifications.getDevicePushTokenAsync();
    const value = typeof token.data === 'string' ? token.data : null;
    if (!value) return null;
    await registerDevice(value, os);
    registeredToken = value;
    return value;
  } catch (error) {
    // No Firebase config, offline: in-app notifications only. Say so in development builds.
    if (__DEV__) console.warn('Push registration skipped:', error);
    return null;
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

/**
 * For a session that ended without a sign-out request (refresh refused: revoked, expired,
 * password changed elsewhere). The API can't be told any more, so the FCM token is deleted on
 * the phone (Firebase `deleteToken`): FCM then reports it dead and the server drops it on its
 * next send, so this phone stops showing the account's notifications. Best effort; the next
 * sign-in registers a fresh token.
 */
export async function releasePushToken(): Promise<void> {
  registeredToken = null;
  const Notifications = loadNotifications();
  if (!Notifications) return;
  try {
    await Notifications.unregisterForNotificationsAsync();
  } catch (error) {
    if (__DEV__) console.warn('Push token release skipped:', error);
  }
}

/** Registers once per sign-in and opens the notification's screen when one is tapped. */
export function usePushNotifications(signedIn: boolean) {
  useEffect(() => {
    if (signedIn) void registerForPush();
  }, [signedIn]);

  useEffect(() => {
    const Notifications = loadNotifications();
    if (!Notifications) return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const link = response.notification.request.content.data?.deep_link;
      if (typeof link === 'string' && link.startsWith('/')) router.push(link as Href);
    });
    return () => sub.remove();
  }, []);
}
