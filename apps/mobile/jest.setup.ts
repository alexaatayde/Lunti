// Jest doesn't read .env. Give tests a fixed, fake API URL (real requests are always mocked).
process.env.EXPO_PUBLIC_API_URL = 'https://api.lunti.test/api/v1';

// No camera or photo library in Jest (test-utils/fakeCamera.ts controls them).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-camera', () => require('./test-utils/fakeCamera').cameraModuleMock);
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-image-picker', () => require('./test-utils/fakeCamera').pickerModuleMock);
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-file-system', () => require('./test-utils/fakeCamera').fileSystemModuleMock);
// No push service in Jest: permission is denied unless a test changes it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-notifications', () => require('./test-utils/fakeNotifications').notificationsModuleMock);
// Connectivity is simulated (test-utils/fakeNetInfo.ts); online unless a test changes it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-community/netinfo', () => require('./test-utils/fakeNetInfo').netInfoModuleMock);
