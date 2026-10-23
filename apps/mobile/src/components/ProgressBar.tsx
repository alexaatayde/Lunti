import { StyleSheet, View } from 'react-native';

import { colors, radius, sizes } from '../theme';

export type ProgressTone = 'normal' | 'warn' | 'danger';

const tones: Record<ProgressTone, { track: string; fill: string }> = {
  normal: { track: colors.track, fill: colors.primaryBright },
  warn: { track: colors.warnBg, fill: colors.warnText },
  danger: { track: colors.dangerBorder, fill: colors.dangerText },
};

export type ProgressBarProps = {
  /** Fraction used, 0–1. Values above 1 show a full bar. */
  value: number;
  tone?: ProgressTone;
  /** 8 (lists) or 10 (hero cards). */
  size?: 'regular' | 'large';
  /** Spoken label, e.g. "Dining out, 97% used". Pair with a Badge so status is not color only. */
  accessibilityLabel?: string;
};

/** Track + fill bar (Home.html budget card, Budget.html). */
export function ProgressBar({
  value,
  tone = 'normal',
  size = 'regular',
  accessibilityLabel,
}: ProgressBarProps) {
  const pct = Math.round(Math.max(0, value) * 100);
  const width = Math.min(100, pct);
  const height = sizes.progress[size];
  const t = tones[tone];
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={[styles.track, { height, backgroundColor: t.track }]}
    >
      <View style={[styles.fill, { width: `${width}%`, backgroundColor: t.fill }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
});
