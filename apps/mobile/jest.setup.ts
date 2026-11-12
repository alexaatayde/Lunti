// Jest doesn't read .env. Give tests a fixed, fake API URL (real requests are always mocked).
process.env.EXPO_PUBLIC_API_URL = 'https://api.lunti.test/api/v1';

// No camera or photo library in Jest (test-utils/fakeCamera.ts controls them).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-camera', () => require('./test-utils/fakeCamera').cameraModuleMock);
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-image-picker', () => require('./test-utils/fakeCamera').pickerModuleMock);
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-file-system', () => require('./test-utils/fakeCamera').fileSystemModuleMock);
