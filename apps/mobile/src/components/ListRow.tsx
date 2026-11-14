import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, sizes, spacing } from '../theme';
import { AppText } from './AppText';

export type IconTileTone = 'primary' | 'warn' | 'danger' | 'neutral';

const tileTones: Record<IconTileTone, { bg: string; fg: string }> = {
  primary: { bg: colors.primaryChipBg, fg: colors.primaryChipTextAlt },
  warn: { bg: colors.warnBg, fg: colors.warnText },
  danger: { bg: colors.dangerBg, fg: colors.dangerText },
  neutral: { bg: colors.surfaceMuted, fg: colors.textStrong },
};

/** Color for an icon placed inside a tile of this tone. */
export const iconTileColor = (tone: IconTileTone) => tileTones[tone].fg;

export type ListRowProps = {
  title: string;
  meta?: string;
  /** Right column, e.g. an amount. */
  value?: string;
  /** Under the value, e.g. "10:42 am". */
  time?: string;
  /** Icon element for the 40 px tile; color it with `iconTileColor(tone)`. */
  icon?: ReactNode;
  iconTone?: IconTileTone;
  /** Draw the divider above this row (every row except the first in a group). */
  divider?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
};

/** Transaction-style row (Transactions.html): icon tile, title + meta, value + time. */
export function ListRow({
  title,
  meta,
  value,
  time,
  icon,
  iconTone = 'primary',
  divider,
  onPress,
  accessibilityLabel,
}: ListRowProps) {
  const tone = tileTones[iconTone];
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={
        accessibilityLabel ?? [title, meta, value, time].filter(Boolean).join(', ')
      }
      style={({ pressed }) => [
        styles.row,
        divider && styles.divider,
        pressed && styles.pressed,
      ]}
    >
      {icon ? <View style={[styles.tile, { backgroundColor: tone.bg }]}>{icon}</View> : null}
      <View style={styles.middle}>
        <AppText variant="rowTitle" numberOfLines={1}>
          {title}
        </AppText>
        {meta ? (
          <AppText variant="meta" numberOfLines={1}>
            {meta}
          </AppText>
        ) : null}
      </View>
      {value || time ? (
        <View style={styles.right}>
          {value ? <AppText variant="rowTitle">{value}</AppText> : null}
          {time ? (
            <AppText variant="small" color={colors.textMuted} style={styles.time}>
              {time}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    minHeight: 64,
    backgroundColor: colors.surface,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.surfaceSubtle },
  tile: {
    width: sizes.listIconTile,
    height: sizes.listIconTile,
    borderRadius: radius.iconTile,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  middle: { flex: 1, minWidth: 0 },
  right: { alignItems: 'flex-end' },
  time: { fontSize: 11, lineHeight: 16 },
});
