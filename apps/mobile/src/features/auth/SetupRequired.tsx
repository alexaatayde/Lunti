import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlertCircleIcon, AppText, PageTitle } from '../../components';
import { missingSupabaseEnv } from '../../lib/supabase';
import { colors, font, radius, spacing } from '../../theme';

/**
 * Shown instead of the app when apps/mobile/.env is missing the Supabase values,
 * so a misconfigured build fails clearly instead of crashing.
 */
export function SetupRequired() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top + 48 }]}>
      <View style={styles.icon}>
        <AlertCircleIcon size={28} color={colors.warnText} />
      </View>
      <PageTitle eyebrow="Setup needed" title="Lunti isn't connected yet" />
      <AppText variant="bodyLarge">
        Add these values to apps/mobile/.env (see .env.example), then restart Expo:
      </AppText>
      <View style={styles.list}>
        {missingSupabaseEnv.map((name) => (
          <AppText key={name} style={styles.code}>
            {name}
          </AppText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.xxl, gap: spacing.lg },
  icon: {
    width: 56,
    height: 56,
    borderRadius: radius.iconTileLarge,
    backgroundColor: colors.warnBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.iconTileLarge,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderInput,
  },
  code: { ...font(600), fontSize: 13, lineHeight: 18, color: colors.text },
});
