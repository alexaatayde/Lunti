/**
 * "You're offline" strip at the top of every signed-in screen (Phase 8C). Not in the design;
 * built in the existing warning style and flagged for review.
 *
 * Screens pad themselves with `useSafeAreaInsets().top`. While the strip is shown it takes the
 * status-bar inset itself and gives the screens below a top inset of 0, so nothing is padded
 * twice or hidden under it.
 *
 * The element tree is the same online and offline (only the strip and the inset value change),
 * so losing the connection never remounts the navigator or clears a half-filled form.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlertTriangleIcon, AppText } from '../../components';
import { useIsOnline } from '../../lib/connectivity';
import { colors, spacing } from '../../theme';

export const OFFLINE_MESSAGE = "You're offline. Showing saved data. Saving needs a connection.";

export function OfflineBoundary({ children }: { children: ReactNode }) {
  const online = useIsOnline();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      {online ? null : (
        <View
          style={[styles.banner, { paddingTop: insets.top + spacing.xs }]}
          accessible
          accessibilityRole="alert"
          accessibilityLabel={OFFLINE_MESSAGE}
          accessibilityLiveRegion="polite"
          testID="offline-banner"
        >
          <AlertTriangleIcon size={16} color={colors.warnStrong} />
          <AppText variant="label" color={colors.warnStrong} style={styles.text}>
            {OFFLINE_MESSAGE}
          </AppText>
        </View>
      )}
      <SafeAreaInsetsContext.Provider value={online ? insets : { ...insets, top: 0 }}>
        <View style={styles.root}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.sm,
    backgroundColor: colors.warnBg,
    borderBottomWidth: 1,
    borderBottomColor: colors.warnBorder,
  },
  text: { flex: 1 },
});

