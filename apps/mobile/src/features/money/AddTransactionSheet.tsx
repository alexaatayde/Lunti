import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  AppText,
  Badge,
  BottomSheet,
  Button,
  CameraIcon,
  ChevronRightIcon,
  EditIcon,
} from '../../components';
import { colors, font, radius, spacing } from '../../theme';

export type AddTransactionSheetProps = {
  visible: boolean;
  onClose: () => void;
  onScan: () => void;
  onManual: () => void;
};

/** "How do you want to add it?" (TxnAddSheet.html). */
export function AddTransactionSheet({ visible, onClose, onScan, onManual }: AddTransactionSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      eyebrow="New transaction"
      title="How do you want to add it?"
    >
      <Option
        tint
        icon={<CameraIcon size={24} color={colors.textOnPrimary} />}
        title="Scan a receipt"
        badge={<Badge label="Fastest" tone="outline" />}
        body="We read the store, items and total. You check before it's saved."
        onPress={onScan}
      />
      <Option
        icon={<EditIcon size={22} color={colors.textStrong} />}
        title="Enter manually"
        body="For cash buys, bills or anything without a receipt."
        onPress={onManual}
      />
      <Button label="Cancel" variant="ghost" onPress={onClose} />
    </BottomSheet>
  );
}

function Option({
  tint,
  icon,
  title,
  badge,
  body,
  onPress,
}: {
  tint?: boolean;
  icon: ReactNode;
  title: string;
  badge?: ReactNode;
  body: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={body}
      style={({ pressed }) => [
        styles.option,
        tint ? styles.optionTint : styles.optionPlain,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.tile, tint ? styles.tileTint : styles.tilePlain]}>{icon}</View>
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <AppText style={styles.title}>{title}</AppText>
          {badge}
        </View>
        <AppText variant="meta" style={styles.body}>
          {body}
        </AppText>
      </View>
      <ChevronRightIcon size={18} color={colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.listCard,
    borderWidth: 1,
  },
  optionTint: { backgroundColor: colors.surfaceTint, borderColor: colors.borderTint },
  optionPlain: { backgroundColor: colors.surface, borderColor: colors.borderInput },
  pressed: { opacity: 0.85 },
  tile: {
    width: 48,
    height: 48,
    borderRadius: radius.iconTileLarge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileTint: { backgroundColor: colors.primary },
  tilePlain: { backgroundColor: colors.surfaceMuted },
  text: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  title: { ...font(700), fontSize: 16, lineHeight: 22, color: colors.text },
  body: { fontSize: 13, lineHeight: 18 },
});
