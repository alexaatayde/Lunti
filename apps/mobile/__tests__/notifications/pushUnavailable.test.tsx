/**
 * Regression: Expo Go 58 lacks native modules that expo-notifications loads at import time
 * ('ExpoApplication', 'ExpoTopicSubscriptionModule'), so importing it crashed the whole app on
 * launch (root layout → push.ts). Here every require of expo-notifications throws, as on such a
 * runtime. The app must start both in Expo Go (module never loaded) and in a development build
 * that is missing the native code (load fails, push disabled with a warning).
 */
import { renderHook } from '@testing-library/react-native';
import { isRunningInExpoGo } from 'expo';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { queryClient } from '../../src/api/queryClient';
import {
  loadNotifications,
  registerForPush,
  resetPushForTests,
  unregisterFromPush,
  usePushNotifications,
} from '../../src/features/notifications/push';
import { useSessionStore } from '../../src/stores/session';
import { mockApi } from '../../test-utils/fakeApi';
import { fakeAuth, fakeSession, resetFakeSupabase } from '../../test-utils/fakeSupabase';
import { PRELOAD_TIMEOUT_MS, preloadRoutes } from '../../test-utils/preloadRoutes';

let mockLoadError: Error | null = new Error("Cannot find native module 'ExpoApplication'");

jest.mock('expo-notifications', () => {
  if (mockLoadError) throw mockLoadError;
  return undefined; // what Metro (dev) hands back after it reports a failed module
});
jest.mock('expo', () => ({ ...jest.requireActual('expo'), isRunningInExpoGo: jest.fn() }));
jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);

const appDir = './app';
const expoGo = isRunningInExpoGo as jest.Mock;
const NATIVE_ERROR = "Cannot find native module 'ExpoApplication'";

let api: ReturnType<typeof mockApi>;
let warn: jest.SpyInstance;

beforeAll(() => preloadRoutes(), PRELOAD_TIMEOUT_MS);

beforeEach(() => {
  mockLoadError = new Error(NATIVE_ERROR);
  expoGo.mockReturnValue(false); // a build that should have push but lacks the native code
  resetPushForTests();
  useSessionStore.setState({ status: 'loading', session: null });
  queryClient.clear();
  api = mockApi();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  api.restore();
  jest.restoreAllMocks();
});

it('launches signed in on Expo Go without loading expo-notifications or warning', async () => {
  expoGo.mockReturnValue(true);
  resetFakeSupabase(fakeSession());
  await renderRouter(appDir, { initialUrl: '/profile' });

  expect(await screen.findByText('Alex Reyes')).toBeOnTheScreen();
  expect(loadNotifications()).toBeNull();
  expect(warn).not.toHaveBeenCalled();
  expect(api.calls('POST', '/api/v1/devices')).toHaveLength(0);
});

it('launches to Welcome when signed out', async () => {
  resetFakeSupabase(null);
  const router = await renderRouter(appDir, { initialUrl: '/' });

  expect(router.getPathname()).toBe('/welcome');
  expect(screen.getByRole('button', { name: 'Get started' })).toBeOnTheScreen();
});

it('launches signed in with push skipped, keeps in-app notifications, and signs out', async () => {
  resetFakeSupabase(fakeSession());
  const router = await renderRouter(appDir, { initialUrl: '/profile' });

  expect(await screen.findByText('Alex Reyes')).toBeOnTheScreen();
  await waitFor(() =>
    expect(warn).toHaveBeenCalledWith(`Push notifications disabled: ${NATIVE_ERROR}`),
  );
  expect(api.calls('POST', '/api/v1/devices')).toHaveLength(0);

  await fireEvent.press(screen.getByRole('button', { name: 'Log out' }));
  expect(fakeAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  await waitFor(() => expect(router.getPathname()).toBe('/welcome'));
  expect(api.calls('DELETE', '/api/v1/devices/fake-fcm-token')).toHaveLength(0);
});

it('skips registration, the tap listener and sign-out cleanup without throwing', async () => {
  resetFakeSupabase(fakeSession());

  expect(loadNotifications()).toBeNull();
  expect(await registerForPush()).toBeNull();
  await expect(renderHook(() => usePushNotifications(true))).resolves.toBeDefined();
  await expect(unregisterFromPush()).resolves.toBeUndefined();
  expect(api.calls('POST', '/api/v1/devices')).toHaveLength(0);
  // Warned once, then the result is cached.
  expect(warn).toHaveBeenCalledTimes(1);
});

it('does not hide unrelated errors raised while loading the module', () => {
  mockLoadError = new Error('Something else broke');

  expect(() => loadNotifications()).toThrow('Something else broke');
  expect(warn).not.toHaveBeenCalled();
});

// Keep last: a factory that returns (rather than throws) is cached by Jest for later tests.
it('disables push when the module loads as nothing (Metro dev after a native error)', async () => {
  mockLoadError = null;

  expect(loadNotifications()).toBeNull();
  expect(await registerForPush()).toBeNull();
  expect(warn).toHaveBeenCalledWith('Push notifications disabled: module failed to load');
});
