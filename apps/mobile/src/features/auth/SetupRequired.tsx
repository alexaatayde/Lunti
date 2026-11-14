import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlertCircleIcon, AppText, PageTitle } from '../../components';
import { appVariant } from '../../lib/env';
import { configProblems, missingSupabaseEnv } from '../../lib/supabase';
import { colors, font, radius, spacing } from '../../theme';

/**
 * Shown instead of the app when apps/mobile/.env is missing the Supabase values, or the build's
 * public config is unsafe (a release build pointing at a local or http server, a non-anon
 * Supabase key), so a misconfigured build fails clearly instead of crashing or leaking data.
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
        {appVariant === 'development'
          ? 'Fix these values in apps/mobile/.env (see .env.example), then restart Expo:'
          : `This ${appVariant} build was made without safe connection settings. Rebuild it after fixing:`}
      </AppText>
      <View style={styles.list}>
        {[...missingSupabaseEnv, ...configProblems].map((item) => (
          <AppText key={item} style={styles.code}>
            {item}
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
