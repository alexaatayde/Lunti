import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useMe } from '../src/api/hooks';
import { AppText, Button, Card } from '../src/components';
import { signOut } from '../src/features/auth/authService';
import { PlaceholderScreen } from '../src/features/placeholder/PlaceholderScreen';
import { useSessionStore } from '../src/stores/session';
import { colors, spacing } from '../src/theme';

/**
 * Profile is still a placeholder (the full screen comes with its feature step). It shows the
 * profile from GET /me — a live check that the app reaches the API — and a working Log out.
 */
export default function ProfileScreen() {
  const email = useSessionStore((s) => s.session?.user.email);
  const me = useMe();
  const [signingOut, setSigningOut] = useState(false);

  const onLogOut = async () => {
    setSigningOut(true);
    try {
      // Clears the session; the route guard then shows Welcome.
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <PlaceholderScreen title="Profile" designFile="Profile" nav="budget" canGoBack>
      <Card size="list" style={styles.account}>
        <View>
          <AppText variant="meta">Signed in as</AppText>
          {me.isPending ? (
            <View style={styles.loading} accessibilityLabel="Loading profile">
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : me.isError ? (
            <View style={styles.error} accessibilityLiveRegion="polite">
              <AppText variant="body" color={colors.dangerText}>
                {me.error.message}
              </AppText>
              <Button label="Try again" variant="ghost" onPress={() => me.refetch()} />
            </View>
          ) : (
            <AppText variant="rowTitle" color={colors.text}>
              {me.data.full_name ?? 'No name yet'}
            </AppText>
          )}
          <AppText variant="meta">{email ?? '—'}</AppText>
        </View>
        <Button label="Log out" variant="secondary" onPress={onLogOut} loading={signingOut} />
      </Card>
    </PlaceholderScreen>
  );
}

const styles = StyleSheet.create({
  account: { gap: spacing.md },
  loading: { paddingVertical: spacing.xs, alignItems: 'flex-start' },
  error: { gap: spacing.sm, paddingVertical: spacing.xs },
});
