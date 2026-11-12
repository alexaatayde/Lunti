/**
 * Fakes for expo-camera and expo-image-picker (no native modules in Jest). Tests set the
 * permission, the next captured photo and the next gallery result.
 */
import { createElement, useEffect, useImperativeHandle, type Ref } from 'react';
import { View } from 'react-native';

type Permission = { granted: boolean; canAskAgain: boolean; status: string };

type Picture = { uri: string; width: number; height: number };

type FakeCamera = {
  permission: Permission | null;
  requestPermission: jest.Mock<Promise<Permission | null>, []>;
  takePicture: jest.Mock<Promise<Picture>, []>;
  pickerResult: unknown;
  launchLibrary: jest.Mock<Promise<unknown>, []>;
};

export const camera: FakeCamera = {
  permission: null,
  requestPermission: jest.fn(async (): Promise<Permission | null> => camera.permission),
  takePicture: jest.fn(
    async (): Promise<Picture> => ({
      uri: 'file:///cache/receipt-photo.jpg',
      width: 1200,
      height: 1600,
    }),
  ),
  pickerResult: { canceled: true, assets: null },
  launchLibrary: jest.fn(async (): Promise<unknown> => camera.pickerResult),
};

export const GRANTED: Permission = { granted: true, canAskAgain: true, status: 'granted' };
export const UNDETERMINED: Permission = { granted: false, canAskAgain: true, status: 'undetermined' };
export const BLOCKED: Permission = { granted: false, canAskAgain: false, status: 'denied' };

export function resetFakeCamera(permission: Permission | null = GRANTED) {
  camera.permission = permission;
  camera.requestPermission.mockClear();
  camera.takePicture.mockClear();
  camera.launchLibrary.mockClear();
  camera.pickerResult = { canceled: true, assets: null };
}

function CameraView({
  ref,
  onCameraReady,
}: {
  ref?: Ref<{ takePictureAsync: typeof camera.takePicture }>;
  onCameraReady?: () => void;
}) {
  useImperativeHandle(ref, () => ({ takePictureAsync: camera.takePicture }));
  useEffect(() => {
    onCameraReady?.();
  }, [onCameraReady]);
  return createElement(View, { testID: 'camera-preview' });
}

export const cameraModuleMock = {
  CameraView,
  useCameraPermissions: () => [camera.permission, camera.requestPermission],
};

export const pickerModuleMock = {
  launchImageLibraryAsync: camera.launchLibrary,
};

/** expo-file-system's File: a Blob-like handle on a local file (the photo to upload). */
class FakeFile extends Blob {
  constructor(readonly uri: string) {
    super(['fake image bytes'], { type: 'image/jpeg' });
  }
}

export const fileSystemModuleMock = { File: FakeFile };
