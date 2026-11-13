import { renderHook } from '@testing-library/react-native';
import { isRunningInExpoGo } from 'expo';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import {
  loadNotifications,
  pushSupported,
  registerForPush,
  releasePushToken,
  resetPushForTests,
  unregisterFromPush,
  usePushNotifications,
} from '../../src/features/notifications/push';
import { mockApi, reply } from '../../test-utils/fakeApi';
import { fakeSession, resetFakeSupabase } from '../../test-utils/fakeSupabase';

// jest-expo reports Expo Go; these tests choose the runtime themselves.
jest.mock('expo', () => ({ ...jest.requireActual('expo'), isRunningInExpoGo: jest.fn() }));
jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);

const mocked = Notifications as jest.Mocked<typeof Notifications>;
const expoGo = isRunningInExpoGo as jest.Mock;
let api: ReturnType<typeof mockApi>;

beforeEach(() => {
  expoGo.mockReturnValue(false);
  resetPushForTests();
  resetFakeSupabase(fakeSession());
  api = mockApi({ 'POST /api/v1/devices': () => reply(204) });
  api.set('DELETE /api/v1/devices/fake-fcm-token', () => reply(204));
});

afterEach(() => {
  api.restore();
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

function runAs(os: 'android' | 'ios', inExpoGo: boolean) {
  jest.replaceProperty(Platform, 'OS', os);
  expoGo.mockReturnValue(inExpoGo);
}

it('registers nothing without notification permission', async () => {
  expect(await registerForPush()).toBeNull();
  expect(api.calls('POST', '/api/v1/devices')).toHaveLength(0);
});

it('sends only the device token to the API, and removes it on sign-out', async () => {
  mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: true, canAskAgain: true } as never);

  expect(await registerForPush()).toBe('fake-fcm-token');
  expect(api.calls('POST', '/api/v1/devices')[0].body).toEqual({
    fcm_token: 'fake-fcm-token',
    platform: 'ios',
  });

  await unregisterFromPush();
  expect(api.calls('DELETE', '/api/v1/devices/fake-fcm-token')).toHaveLength(1);
  await unregisterFromPush(); // nothing left to remove
  expect(api.calls('DELETE', '/api/v1/devices/fake-fcm-token')).toHaveLength(1);
});

it('stays usable when the token is unavailable (no Firebase config), and says so in dev', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: true, canAskAgain: true } as never);
  mocked.getDevicePushTokenAsync.mockRejectedValueOnce(new Error('No FCM config'));

  expect(await registerForPush()).toBeNull();
  expect(api.calls('POST', '/api/v1/devices')).toHaveLength(0);
  expect(warn).toHaveBeenCalledWith('Push registration skipped:', expect.any(Error));
});

describe('Android development or release build (native push available)', () => {
  beforeEach(() => runAs('android', false));

  it('loads expo-notifications, creates the channel and registers the token', async () => {
    mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: true, canAskAgain: true } as never);

    expect(pushSupported()).toBe(true);
    expect(loadNotifications()).not.toBeNull();
    expect(await registerForPush()).toBe('fake-fcm-token');
    expect(mocked.setNotificationChannelAsync).toHaveBeenCalledWith('default', {
      name: 'Lunti',
      importance: 6,
    });
    expect(api.calls('POST', '/api/v1/devices')[0].body).toEqual({
      fcm_token: 'fake-fcm-token',
      platform: 'android',
    });
  });

  it('deletes the FCM token on the phone when the session ends without a sign-out', async () => {
    mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: true, canAskAgain: true } as never);
    await registerForPush();

    await releasePushToken();

    expect(mocked.unregisterForNotificationsAsync).toHaveBeenCalledTimes(1);
    // The API can't be reached with a dead session, so it is not called.
    expect(api.calls('DELETE', '/api/v1/devices/fake-fcm-token')).toHaveLength(0);
    await unregisterFromPush(); // nothing left to remove afterwards
    expect(api.calls('DELETE', '/api/v1/devices/fake-fcm-token')).toHaveLength(0);
  });

  it('keeps going if Firebase cannot delete the token', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mocked.unregisterForNotificationsAsync.mockRejectedValueOnce(new Error('offline'));

    await expect(releasePushToken()).resolves.toBeUndefined();
  });

  it('opens the deep link of a tapped notification, and unsubscribes on unmount', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    const { unmount } = await renderHook(() => usePushNotifications(false));

    expect(mocked.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);
    const onTap = mocked.addNotificationResponseReceivedListener.mock.calls[0][0];
    onTap({ notification: { request: { content: { data: { deep_link: '/meals/pantry' } } } } } as never);
    onTap({ notification: { request: { content: { data: { deep_link: 'https://x' } } } } } as never);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/meals/pantry');

    const sub = mocked.addNotificationResponseReceivedListener.mock.results[0].value;
    await unmount();
    expect(sub.remove).toHaveBeenCalled();
  });
});

describe.each(['android', 'ios'] as const)('Expo Go on %s (no FCM push)', (os) => {
  beforeEach(() => runAs(os, true));

  it('never loads expo-notifications and skips registration quietly', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(pushSupported()).toBe(false);
    expect(await registerForPush()).toBeNull();
    await renderHook(() => usePushNotifications(true));

    expect(mocked.getPermissionsAsync).not.toHaveBeenCalled();
    expect(mocked.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
    expect(api.calls('POST', '/api/v1/devices')).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('has no token to release when the session ends', async () => {
    await expect(releasePushToken()).resolves.toBeUndefined();
    expect(mocked.unregisterForNotificationsAsync).not.toHaveBeenCalled();
  });

  it('signs out without calling the API, since no token was registered', async () => {
    await registerForPush();
    await expect(unregisterFromPush()).resolves.toBeUndefined();
    expect(api.calls('DELETE', '/api/v1/devices/fake-fcm-token')).toHaveLength(0);
  });
});
