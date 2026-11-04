import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card } from '../src/components';
import { signOut } from '../src/features/auth/authService';
import { PlaceholderScreen } from '../src/features/placeholder/PlaceholderScreen';
import { useSessionStore } from '../src/stores/session';
import { colors, spacing } from '../src/theme';

/**
 * Profile is still a placeholder (full screen: build step 2+). Log out works now so the
 * auth flow can be tested end to end.
 */
export default function ProfileScreen() {
  const email = useSessionStore((s) => s.session?.user.email);
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
          <AppText variant="rowTitle" color={colors.text}>
            {email ?? '—'}
          </AppText>
        </View>
        <Button label="Log out" variant="secondary" onPress={onLogOut} loading={signingOut} />
      </Card>
    </PlaceholderScreen>
  );
}

const styles = StyleSheet.create({
  account: { gap: spacing.md },
});
