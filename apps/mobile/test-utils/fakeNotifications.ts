/** expo-notifications stand-in for Jest: no permission and no token unless a test sets them. */
export const notificationsModuleMock = {
  AndroidImportance: { HIGH: 6, DEFAULT: 5 },
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: false })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: false })),
  setNotificationChannelAsync: jest.fn(async () => null),
  getDevicePushTokenAsync: jest.fn(async () => ({ type: 'android', data: 'fake-fcm-token' })),
  unregisterForNotificationsAsync: jest.fn(async () => undefined),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
};
