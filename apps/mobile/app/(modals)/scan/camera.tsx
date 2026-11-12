/**
 * ScanCamera (ScanCamera.html; SRS 3.1.2, 3.7.2). Steps:
 *   capture  – live camera with framing guide, Gallery, shutter, Flash (or permission help)
 *   preview  – the photo with Retake / Use photo (nothing is sent before "Use photo")
 *   reading  – step 2 "Processing": upload + OCR
 *   error    – connection / service trouble: retry the same photo, retake or enter manually
 * A readable receipt opens the review; an unreadable one opens ScanFailed.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUploadReceipt } from '../../../src/api/hooks';
import {
  AlertCircleIcon,
  AppText,
  Button,
  CameraIcon,
  FlashIcon,
  ImageIcon,
} from '../../../src/components';
import {
  discardQuietly,
  enterManually,
  leaveScan,
  uploadMessage,
  useHardwareBack,
} from '../../../src/features/scan/flow';
import { photoFrom, pickFromGallery } from '../../../src/features/scan/pickPhoto';
import { ScanHeader } from '../../../src/features/scan/ScanHeader';
import { useScanStore } from '../../../src/stores/scan';
import { colors, font, radius, spacing } from '../../../src/theme';

type Phase = 'capture' | 'preview' | 'reading' | 'error';

export default function ScanCameraScreen() {
  const insets = useSafeAreaInsets();
  const photo = useScanStore((s) => s.photo);
  const setPhoto = useScanStore((s) => s.setPhoto);
  const upload = useUploadReceipt();
  // A photo chosen on the failed screen ("Choose another image") starts in preview.
  const [phase, setPhase] = useState<Phase>(photo ? 'preview' : 'capture');
  const [error, setError] = useState<string | null>(null);
  useHardwareBack(leaveScan);

  const usePhoto = async () => {
    const { photo: current, uploadId } = useScanStore.getState();
    if (!current || !uploadId) return;
    setPhase('reading');
    setError(null);
    try {
      const receipt = await upload.mutateAsync({ photo: current, uploadId });
      if (useScanStore.getState().uploadId !== uploadId) {
        // The user cancelled or retook while it was reading: drop the unsaved receipt.
        discardQuietly(receipt.id);
        return;
      }
      useScanStore.getState().setReceipt(receipt);
      router.replace(receipt.status === 'failed' ? '/scan/failed' : '/scan/review');
    } catch (e) {
      if (useScanStore.getState().uploadId !== uploadId) return;
      setError(uploadMessage(e));
      setPhase('error');
    }
  };

  const chooseFromGallery = async () => {
    const result = await pickFromGallery();
    if (result.kind === 'picked') {
      setPhoto(result.photo);
      setPhase('preview');
    } else if (result.kind === 'error') {
      setError("Couldn't open your photos. Please try again.");
    }
  };

  const retake = () => {
    useScanStore.getState().reset();
    setError(null);
    setPhase('capture');
  };

  const dark = phase === 'capture';
  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
        !dark && styles.rootLight,
      ]}
    >
      <ScanHeader
        step={phase === 'reading' || phase === 'error' ? 2 : 1}
        dark={dark}
        onCancel={leaveScan}
      />
      {phase === 'capture' ? (
        <Capture
          onCaptured={(uri) => {
            setPhoto(photoFrom(uri, 'image/jpeg'));
            setPhase('preview');
          }}
          onGallery={chooseFromGallery}
          galleryError={error}
        />
      ) : (
        <Review
          phase={phase}
          uri={photo?.uri}
          error={error}
          onUse={usePhoto}
          onRetake={retake}
          onManual={enterManually}
        />
      )}
    </View>
  );
}

// ---------- capture ----------

function Capture({
  onCaptured,
  onGallery,
  galleryError,
}: {
  onCaptured: (uri: string) => void;
  onGallery: () => void;
  galleryError: string | null;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const capture = async () => {
    if (!camera.current || !ready || busy) return;
    setBusy(true);
    try {
      const picture = await camera.current.takePictureAsync({ quality: 0.7, exif: false });
      if (picture?.uri) onCaptured(picture.uri);
    } catch {
      setCameraError("Couldn't take the photo. Try again or choose one from your gallery.");
    } finally {
      setBusy(false);
    }
  };

  let viewfinder;
  if (!permission) {
    viewfinder = <ActivityIndicator color={colors.cameraAccent} accessibilityLabel="Starting camera" />;
  } else if (!permission.granted) {
    viewfinder = (
      <View style={styles.permission}>
        <CameraIcon size={36} color={colors.cameraAccent} />
        <AppText style={styles.permissionTitle} accessibilityRole="header">
          {permission.canAskAgain ? 'Allow camera access' : 'Camera access is off'}
        </AppText>
        <AppText style={styles.permissionBody}>
          {permission.canAskAgain
            ? 'Lunti uses the camera only to photograph receipts you choose to scan.'
            : 'Turn on camera access for Lunti in Settings, or choose a receipt photo from your gallery.'}
        </AppText>
        <Button
          label={permission.canAskAgain ? 'Allow camera' : 'Open settings'}
          onPress={() => (permission.canAskAgain ? requestPermission() : Linking.openSettings())}
        />
      </View>
    );
  } else {
    viewfinder = (
      <>
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          onCameraReady={() => setReady(true)}
          onMountError={() =>
            setCameraError("The camera couldn't start. Choose a receipt photo from your gallery.")
          }
          accessibilityLabel="Camera preview"
        />
        <View pointerEvents="none" style={styles.frame} />
      </>
    );
  }

  const hint = cameraError ?? galleryError ?? 'Fit the whole receipt in the frame · flat and well lit';
  return (
    <>
      <View style={styles.viewfinder}>
        {viewfinder}
        <View style={styles.hintWrap} pointerEvents="none">
          <AppText
            style={[styles.hint, (cameraError || galleryError) && styles.hintError]}
            accessibilityLiveRegion="polite"
          >
            {hint}
          </AppText>
        </View>
      </View>
      <View style={styles.controls}>
        <ControlButton label="Gallery" onPress={onGallery} icon={<ImageIcon size={22} color={colors.textOnPrimary} />} />
        <Pressable
          onPress={capture}
          disabled={!permission?.granted || !ready || busy}
          accessibilityRole="button"
          accessibilityLabel="Capture receipt"
          accessibilityState={{ disabled: !permission?.granted || !ready || busy, busy }}
          style={({ pressed }) => [
            styles.shutter,
            (!permission?.granted || !ready) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {busy ? <ActivityIndicator color={colors.cameraBg} /> : <View style={styles.shutterInner} />}
        </Pressable>
        <ControlButton
          label={torch ? 'Flash on' : 'Flash'}
          selected={torch}
          disabled={!permission?.granted}
          onPress={() => setTorch((t) => !t)}
          icon={<FlashIcon size={22} color={torch ? colors.cameraBg : colors.textOnPrimary} />}
        />
      </View>
    </>
  );
}

function ControlButton({
  label,
  icon,
  onPress,
  selected,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      style={({ pressed }) => [styles.control, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <View style={[styles.controlTile, selected && styles.controlTileOn]}>{icon}</View>
      <AppText style={styles.controlLabel}>{label}</AppText>
    </Pressable>
  );
}

// ---------- preview / reading / error ----------

function Review({
  phase,
  uri,
  error,
  onUse,
  onRetake,
  onManual,
}: {
  phase: Phase;
  uri?: string;
  error: string | null;
  onUse: () => void;
  onRetake: () => void;
  onManual: () => void;
}) {
  const reading = phase === 'reading';
  return (
    <View style={styles.reviewBody}>
      <View style={styles.photoBox}>
        {uri ? (
          <Image
            source={{ uri }}
            style={[StyleSheet.absoluteFill, reading && styles.dimmed]}
            contentFit="contain"
            accessibilityLabel="Receipt photo"
          />
        ) : null}
        {reading ? (
          <View style={styles.readingOverlay} accessibilityLiveRegion="polite">
            <ActivityIndicator size="large" color={colors.primary} />
            <AppText variant="cardTitle">Reading your receipt…</AppText>
            <AppText variant="meta">This can take a few seconds. Nothing is saved yet.</AppText>
          </View>
        ) : null}
      </View>

      {phase === 'error' && error ? (
        <View style={styles.errorBox} accessibilityLiveRegion="polite">
          <AlertCircleIcon size={18} color={colors.dangerText} />
          <AppText variant="body" color={colors.dangerText} style={styles.flex}>
            {error}
          </AppText>
        </View>
      ) : null}

      <View style={styles.actions}>
        {phase === 'preview' ? (
          <>
            <Button label="Use photo" onPress={onUse} />
            <Button label="Retake" variant="secondary" onPress={onRetake} />
          </>
        ) : null}
        {phase === 'error' ? (
          <>
            <Button label="Try again" onPress={onUse} />
            <Button label="Retake photo" variant="secondary" onPress={onRetake} />
            <Button label="Enter the expense manually" variant="ghost" onPress={onManual} />
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cameraBg },
  rootLight: { backgroundColor: colors.bg },
  viewfinder: {
    flex: 1,
    marginHorizontal: spacing.lg,
    borderRadius: radius.pageCard,
    backgroundColor: colors.cameraSurface,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    position: 'absolute',
    left: 34,
    right: 34,
    top: 34,
    bottom: 74,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.cameraFrame,
    borderRadius: 16,
  },
  hintWrap: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.xl, alignItems: 'center' },
  hint: {
    ...font(400),
    fontSize: 13,
    color: colors.textOnPrimary,
    backgroundColor: colors.cameraHintBg,
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
    borderRadius: 16,
    overflow: 'hidden',
    textAlign: 'center',
  },
  hintError: { color: colors.dangerBorder },
  permission: { padding: spacing.xxl, alignItems: 'center', gap: spacing.md },
  permissionTitle: { ...font(700), fontSize: 18, color: colors.textOnPrimary, textAlign: 'center' },
  permissionBody: { ...font(400), fontSize: 14, lineHeight: 20, color: colors.cameraMuted, textAlign: 'center' },
  controls: {
    paddingHorizontal: 28,
    paddingTop: 22,
    paddingBottom: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  control: { width: 72, alignItems: 'center', gap: 6 },
  controlTile: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.cameraControl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlTileOn: { backgroundColor: colors.cameraAccent },
  controlLabel: { ...font(400), fontSize: 12, color: colors.textOnPrimary },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: colors.textOnPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.cameraAccent },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  reviewBody: { flex: 1, padding: spacing.screen, gap: spacing.lg },
  photoBox: {
    flex: 1,
    borderRadius: radius.pageCard,
    backgroundColor: colors.reviewViewfinder,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderTint,
  },
  dimmed: { opacity: 0.35 },
  readingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xxl,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.input,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  flex: { flex: 1 },
  actions: { gap: spacing.sm },
});
