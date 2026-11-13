import * as Notifications from 'expo-notifications';

import { registerForPush, unregisterFromPush } from '../../src/features/notifications/push';
import { mockApi, reply } from '../../test-utils/fakeApi';
import { fakeSession, resetFakeSupabase } from '../../test-utils/fakeSupabase';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);

const mocked = Notifications as jest.Mocked<typeof Notifications>;
let api: ReturnType<typeof mockApi>;

beforeEach(() => {
  resetFakeSupabase(fakeSession());
  api = mockApi({ 'POST /api/v1/devices': () => reply(204) });
  api.set('DELETE /api/v1/devices/fake-fcm-token', () => reply(204));
});

afterEach(() => {
  api.restore();
  jest.clearAllMocks();
});

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

it('stays quiet when push is unavailable (Expo Go, no Firebase config)', async () => {
  mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: true, canAskAgain: true } as never);
  mocked.getDevicePushTokenAsync.mockRejectedValueOnce(new Error('No FCM in Expo Go'));
  expect(await registerForPush()).toBeNull();
  expect(api.calls('POST', '/api/v1/devices')).toHaveLength(0);
});
