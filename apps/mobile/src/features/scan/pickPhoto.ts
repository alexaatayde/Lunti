/** Photo picking for the scan flow: gallery (expo-image-picker). The camera lives on its screen. */
import * as ImagePicker from 'expo-image-picker';

import type { ReceiptPhoto } from '../../api/hooks';

export type PickResult =
  | { kind: 'picked'; photo: ReceiptPhoto }
  | { kind: 'cancelled' }
  | { kind: 'error' };

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function photoFrom(uri: string, mimeType?: string | null): ReceiptPhoto {
  const type = mimeType && EXTENSIONS[mimeType] ? mimeType : guessType(uri);
  return { uri, mimeType: type, fileName: `receipt.${EXTENSIONS[type] ?? 'jpg'}` };
}

function guessType(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * Opens the system photo picker (Android 13+ and iOS 14+ need no library permission for it).
 * Quality 1 keeps the original file (no re-compression).
 */
export async function pickFromGallery(): Promise<PickResult> {
  let result: ImagePicker.ImagePickerResult;
  try {
    result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
      exif: false,
    });
  } catch {
    return { kind: 'error' };
  }
  if (result.canceled || !result.assets?.length) return { kind: 'cancelled' };
  const asset = result.assets[0];
  return { kind: 'picked', photo: photoFrom(asset.uri, asset.mimeType) };
}
