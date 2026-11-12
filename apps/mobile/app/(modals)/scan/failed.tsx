/**
 * ScanFailed (ScanFailed.html; SRS 3.3.2): the photo couldn't be read. Nothing was saved.
 * Offers: Try scanning again · Choose another image · Enter the expense manually.
 * Every way out discards the failed receipt and its photo.
 */
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AlertCircleIcon,
  AppText,
  Button,
  FlatReceiptIcon,
  FrameIcon,
  ReceiptQuestionIcon,
  SunIcon,
} from '../../../src/components';
import {
  discardQuietly,
  enterManually,
  leaveScan,
  restartScan,
  useHardwareBack,
} from '../../../src/features/scan/flow';
import { pickFromGallery } from '../../../src/features/scan/pickPhoto';
import { ScanHeader } from '../../../src/features/scan/ScanHeader';
import { useScanStore } from '../../../src/stores/scan';
import { colors, font, radius, spacing } from '../../../src/theme';

const MESSAGES = {
  unreadable: 'The text was too unclear to pull out the items and total. Nothing was saved.',
  no_amounts: "We couldn't find any prices or a total in this photo. Nothing was saved.",
} as const;

export default function ScanFailedScreen() {
  const insets = useSafeAreaInsets();
  const receipt = useScanStore((s) => s.receipt);
  const [pickError, setPickError] = useState<string | null>(null);
  const reason = receipt?.failure_reason ?? 'unreadable';

  const cancel = () => {
    discardQuietly(receipt?.id);
    leaveScan();
  };
  useHardwareBack(cancel);

  const chooseAnother = async () => {
    setPickError(null);
    const result = await pickFromGallery();
    if (result.kind === 'cancelled') return;
    if (result.kind === 'error') {
      setPickError("Couldn't open your photos. Please try again.");
      return;
    }
    discardQuietly(useScanStore.getState().receipt?.id);
    useScanStore.getState().setPhoto(result.photo); // new upload id
    router.replace('/scan/camera'); // opens on the photo preview
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScanHeader step={2} failed onCancel={cancel} />
      <ScrollView contentContainerStyle={styles.main}>
        <View style={styles.hero}>
          <ReceiptQuestionIcon
            size={48}
            color={colors.dangerText}
            accessibilityLabel="Receipt could not be read"
          />
        </View>
        <View style={styles.copy}>
          <AppText style={styles.title} accessibilityRole="header">
            We couldn&apos;t read this receipt
          </AppText>
          <AppText style={styles.body}>{MESSAGES[reason]}</AppText>
          {receipt?.simulated ? (
            <AppText variant="meta" style={styles.center}>
              Development mode: simulated OCR only recognises the synthetic test receipts.
            </AppText>
          ) : null}
        </View>
        <View style={styles.tips}>
          <Tip icon={<SunIcon size={18} color={colors.primary} />} text="Use bright, even light" />
          <Tip
            icon={<FlatReceiptIcon size={18} color={colors.primary} />}
            text="Flatten folds and creases"
          />
          <Tip
            icon={<FrameIcon size={18} color={colors.primary} />}
            text="Keep the whole receipt in the frame"
          />
        </View>
        {pickError ? (
          <View style={styles.error} accessibilityLiveRegion="polite">
            <AlertCircleIcon size={16} color={colors.dangerText} />
            <AppText variant="body" color={colors.dangerText}>
              {pickError}
            </AppText>
          </View>
        ) : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: spacing.xxl + insets.bottom }]}>
        <Button label="Try scanning again" onPress={restartScan} />
        <Button label="Choose another image" variant="secondary" onPress={chooseAnother} />
        <Button label="Enter the expense manually" variant="ghost" onPress={enterManually} />
      </View>
    </View>
  );
}

function Tip({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <View style={styles.tip}>
      {icon}
      <AppText variant="body" color={colors.text}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  main: { paddingTop: 40, paddingHorizontal: spacing.xxl, alignItems: 'center', gap: 18 },
  hero: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.dangerBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { gap: spacing.sm, alignItems: 'center' },
  title: { ...font(700), fontSize: 22, lineHeight: 28, color: colors.text, textAlign: 'center' },
  body: {
    ...font(400),
    fontSize: 15,
    lineHeight: 22,
    color: colors.textBody,
    textAlign: 'center',
  },
  center: { textAlign: 'center' },
  tips: {
    alignSelf: 'stretch',
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderInput,
    borderRadius: radius.input,
    gap: 10,
  },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  error: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  footer: { paddingHorizontal: spacing.screen, paddingTop: spacing.lg, gap: 10 },
});
