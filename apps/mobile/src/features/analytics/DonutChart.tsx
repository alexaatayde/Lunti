/** Category donut (Analytics.html: 120 px ring, total in the middle). Drawn with react-native-svg. */
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { AppText } from '../../components';
import { formatMoney } from '../../lib/money';
import { colors, font } from '../../theme';

const SIZE = 132;
const STROKE = 24;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

export const SLICE_COLORS = [
  colors.chart1,
  colors.chart2,
  colors.chart3,
  colors.chart4,
  colors.chart5,
] as const;

export function DonutChart({
  slices,
  total,
}: {
  slices: { key: string; pct: number }[];
  total: string;
}) {
  const sum = slices.reduce((s, x) => s + x.pct, 0) || 1;
  const arcs = slices.map((slice, i) => {
    const before = slices.slice(0, i).reduce((s, x) => s + x.pct, 0);
    return {
      key: slice.key,
      length: (slice.pct / sum) * CIRCUMFERENCE,
      offset: (before / sum) * CIRCUMFERENCE,
    };
  });
  return (
    // The legend below carries the same figures for screen readers.
    <View style={styles.wrap} importantForAccessibility="no-hide-descendants" accessible={false}>
      <Svg width={SIZE} height={SIZE}>
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke={colors.track}
          strokeWidth={STROKE}
          fill="none"
        />
        <G rotation={-90} origin={`${SIZE / 2}, ${SIZE / 2}`}>
          {arcs.map((arc, i) => (
            <Circle
              key={arc.key}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              stroke={SLICE_COLORS[i % SLICE_COLORS.length]}
              strokeWidth={STROKE}
              strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
              strokeDashoffset={-arc.offset}
              fill="none"
            />
          ))}
        </G>
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <AppText style={styles.total} numberOfLines={1} adjustsFontSizeToFit>
          {formatMoney(total)}
        </AppText>
        <AppText variant="meta">total</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, alignSelf: 'center' },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: STROKE + 4,
  },
  total: { ...font(800), fontSize: 15, color: colors.text },
});
