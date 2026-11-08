/** Loading, empty and error blocks shared by the money screens (AGENTS.md §8 "States"). */
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, View, type DimensionValue } from 'react-native';

import { AlertCircleIcon, AppText, Button, Card } from '../../components';
import { colors, radius, spacing } from '../../theme';

/** Grey placeholder block that gently pulses while data loads. */
export function SkeletonBlock({
  height,
  width = '100%',
  rounded = radius.listCard,
}: {
  height: number;
  width?: DimensionValue;
  rounded?: number;
}) {
  const [opacity] = useState(() => new Animated.Value(0.55));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.55, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={{ height, width, borderRadius: rounded, backgroundColor: colors.border, opacity }}
    />
  );
}

/** A few skeleton cards, announced to screen readers as loading. */
export function LoadingBlocks({ label, heights }: { label: string; heights: number[] }) {
  return (
    <View
      style={styles.stack}
      accessible
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      testID="loading"
    >
      {heights.map((h, i) => (
        <SkeletonBlock key={i} height={h} />
      ))}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <Card size="list" style={styles.error}>
      <View style={styles.errorRow} accessibilityLiveRegion="polite">
        <AlertCircleIcon size={18} color={colors.dangerText} />
        <AppText variant="body" color={colors.dangerText} style={styles.flex}>
          {message}
        </AppText>
      </View>
      <Button label="Try again" variant="secondary" onPress={onRetry} loading={retrying} />
    </Card>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <Card size="list" style={styles.empty}>
      <AppText variant="cardTitle" style={styles.center}>
        {title}
      </AppText>
      {message ? (
        <AppText variant="body" style={styles.center}>
          {message}
        </AppText>
      ) : null}
      {action}
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  error: { gap: spacing.md, padding: spacing.lg },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  empty: { gap: spacing.sm, padding: spacing.xl, alignItems: 'stretch' },
  center: { textAlign: 'center' },
});
