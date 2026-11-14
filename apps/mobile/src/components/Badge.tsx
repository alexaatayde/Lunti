import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, font, radius } from '../theme';
import { AppText, DENSE_FONT_SCALE } from './AppText';
import { AlertCircleIcon, AlertTriangleIcon, ClockIcon } from './icons';

export type BadgeTone = 'success' | 'outline' | 'neutral' | 'warn' | 'danger';

const tones: Record<BadgeTone, { bg: string; fg: string; border?: string }> = {
  // Home.html "60% of cap"
  success: { bg: colors.primaryChipBg, fg: colors.primaryChipTextAlt },
  // Transactions.html "31 scanned"
  outline: { bg: colors.surface, fg: colors.primaryChipTextAlt, border: colors.borderTint },
  // Transactions.html "11 manual"
  neutral: { bg: colors.surface, fg: colors.textBody, border: colors.borderInput },
  // Budget.html "Near limit", Home.html "Use today"
  warn: { bg: colors.warnBg, fg: colors.warnStrong },
  // Budget.html "Exceeded"
  danger: { bg: colors.dangerBg, fg: colors.dangerText, border: colors.dangerBorder },
};

export type BadgeProps = {
  label: string;
  tone?: BadgeTone;
  /**
   * Leading icon. Warn and danger badges get a default icon so status is never shown by
   * color alone (DESIGN_HANDOFF.md §5.7). Pass `null` to remove it.
   */
  icon?: ReactNode | null;
};

const defaultIcon = (tone: BadgeTone, color: string): ReactNode => {
  if (tone === 'warn') return <AlertTriangleIcon size={12} color={color} />;
  if (tone === 'danger') return <AlertCircleIcon size={12} color={color} />;
  return null;
};

export function Badge({ label, tone = 'success', icon }: BadgeProps) {
  const t = tones[tone];
  const leading = icon === undefined ? defaultIcon(tone, t.fg) : icon;
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: t.bg },
        t.border ? { borderWidth: 1, borderColor: t.border } : null,
      ]}
    >
      {leading}
      <AppText style={[styles.text, { color: t.fg }]} maxFontSizeMultiplier={DENSE_FONT_SCALE}>
        {label}
      </AppText>
    </View>
  );
}

/** Convenience for the "Use today" style badge with a clock. */
export function ClockBadge({ label }: { label: string }) {
  return <Badge label={label} tone="warn" icon={<ClockIcon size={12} color={colors.warnStrong} />} />;
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
  },
  text: { ...font(700), fontSize: 11, lineHeight: 16 },
});
