/**
 * Scan flow top bar: Cancel · "Scan receipt" · "Step n of 3", then the three-step progress
 * (ScanCamera.html / ScanFailed.html). `dark` is the camera screen.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, CloseIcon } from '../../components';
import { colors, font, spacing } from '../../theme';

export type ScanStep = 1 | 2 | 3;

const LABELS = ['Capture', 'Processing', 'Review'] as const;

export function ScanHeader({
  step,
  failed = false,
  dark = false,
  onCancel,
}: {
  step: ScanStep;
  /** Step 2 failed: shown in red as "Processing failed" (with words, not color alone). */
  failed?: boolean;
  dark?: boolean;
  onCancel: () => void;
}) {
  const text = dark ? colors.textOnPrimary : colors.text;
  const muted = dark ? colors.cameraMuted : colors.textMuted;
  return (
    <View style={[styles.header, !dark && styles.light]}>
      <View style={styles.top}>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel scan"
          hitSlop={8}
          style={styles.cancel}
        >
          <CloseIcon size={18} color={text} strokeWidth={2} />
          <AppText style={[styles.cancelText, { color: text }]}>Cancel</AppText>
        </Pressable>
        <AppText style={[styles.title, { color: text }]} accessibilityRole="header">
          Scan receipt
        </AppText>
        <AppText style={[styles.step, { color: muted }]}>Step {step} of 3</AppText>
      </View>
      <View style={styles.progress} accessibilityLabel={`Step ${step} of 3, ${LABELS[step - 1]}`}>
        {LABELS.map((label, index) => {
          const n = index + 1;
          const isFailed = failed && n === 2;
          const done = n < step && !isFailed;
          const current = n === step;
          const bar = isFailed
            ? colors.dangerText
            : done || current
              ? dark
                ? colors.cameraAccent
                : colors.primary
              : dark
                ? colors.cameraTrack
                : colors.track;
          return (
            <View key={label} style={styles.segment}>
              <View style={[styles.bar, { backgroundColor: bar }]} />
              <AppText
                style={[
                  styles.label,
                  { color: isFailed ? colors.dangerText : current ? text : muted },
                  current && font(700),
                ]}
              >
                {isFailed ? 'Processing failed' : done ? `${label} ✓` : label}
              </AppText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: 14 },
  light: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cancel: {
    minHeight: 44,
    minWidth: 84,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  cancelText: { ...font(500), fontSize: 15 },
  title: { ...font(700), fontSize: 17 },
  step: { ...font(400), width: 84, textAlign: 'right', fontSize: 13 },
  progress: { flexDirection: 'row', gap: spacing.sm },
  segment: { flex: 1, gap: 6 },
  bar: { height: 4, borderRadius: 2 },
  label: { ...font(400), fontSize: 12 },
});
