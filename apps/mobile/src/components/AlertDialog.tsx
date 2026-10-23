import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { colors, font, radius, shadows, spacing } from '../theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { TrashIcon } from './icons';

export type AlertDialogProps = {
  visible: boolean;
  title: string;
  /** Explanation under the summary row. Can contain nested AppText for emphasis. */
  message?: ReactNode;
  /** Optional summary row, e.g. store + amount of the transaction being deleted. */
  summary?: { label: string; value: string };
  /** Icon in the round badge; defaults to a trash can. */
  icon?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** `danger` = red badge + red confirm button (delete). */
  tone?: 'danger' | 'primary';
  loading?: boolean;
};

/** Centered confirmation dialog (TxnDelete.html). */
export function AlertDialog({
  visible,
  title,
  message,
  summary,
  icon,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  tone = 'danger',
  loading,
}: AlertDialogProps) {
  const danger = tone === 'danger';
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          style={styles.scrim}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View style={styles.dialog} accessibilityViewIsModal accessibilityRole="alert">
          <View
            style={[
              styles.iconBadge,
              { backgroundColor: danger ? colors.dangerBg : colors.primaryChipBg },
            ]}
          >
            {icon ?? <TrashIcon color={danger ? colors.dangerText : colors.primary} />}
          </View>
          <AppText variant="dialogTitle" style={styles.center} accessibilityRole="header">
            {title}
          </AppText>
          {summary || message ? (
            <View style={styles.body}>
              {summary ? (
                <View style={styles.summary}>
                  <AppText style={styles.summaryLabel} numberOfLines={1}>
                    {summary.label}
                  </AppText>
                  <AppText style={styles.summaryValue}>{summary.value}</AppText>
                </View>
              ) : null}
              {message ? (
                <AppText variant="meta" style={styles.message}>
                  {message}
                </AppText>
              ) : null}
            </View>
          ) : null}
          <View style={styles.actions}>
            <Button label={cancelLabel} variant="ghost" onPress={onCancel} style={styles.action} />
            <Button
              label={confirmLabel}
              variant={danger ? 'danger' : 'primary'}
              onPress={onConfirm}
              loading={loading}
              style={styles.action}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xxl },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim },
  dialog: {
    backgroundColor: colors.surface,
    borderRadius: radius.dialog,
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    boxShadow: shadows.dialog,
  },
  iconBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
  body: { alignSelf: 'stretch', gap: 10 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.toast,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryLabel: { ...font(600), fontSize: 14, lineHeight: 20, color: colors.text, flex: 1 },
  summaryValue: { ...font(800), fontSize: 14, lineHeight: 20, color: colors.text },
  message: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: spacing.xs },
  action: { flex: 1, paddingHorizontal: spacing.sm },
});
