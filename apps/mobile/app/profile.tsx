/**
 * Profile (Profile.html, SRS 3.5). Profile.html is from the earlier visual generation, so its
 * layout is kept and drawn with the current tokens (DESIGN_HANDOFF.md §6).
 *
 * Shows only what the API supports today: the profile from GET /me, a link to the notification
 * settings (switches and muted items live on the Notifications screen), read-only account facts
 * and Log out. Not built yet, so left out (flagged for review): editing the name, expense
 * categories, change password, privacy & data export, and account deletion (no DELETE /me).
 */
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMe, type Me } from '../src/api/hooks';
import {
  AppText,
  BellIcon,
  BottomNav,
  Card,
  ChevronRightIcon,
  SegmentedControl,
  type TabKey,
} from '../src/components';
import { signOut } from '../src/features/auth/authService';
import { ErrorState, LoadingBlocks } from '../src/features/money/StateViews';
import { formatLongDate } from '../src/lib/dates';
import { colors, font, radius, sizes, spacing } from '../src/theme';

const tabHref = {
  analytics: '/analytics',
  budget: '/budget',
  home: '/home',
  meals: '/meals',
  transactions: '/transactions',
} as const satisfies Record<TabKey, string>;

/** "A" for "Alex Reyes", else the email's first letter, else "?". */
function initialOf(name: string | null | undefined, email: string | null | undefined) {
  const source = name?.trim() || email?.trim() || '';
  return source ? source[0].toLocaleUpperCase() : '?';
}

const dateOrNull = (iso: string | null) => (iso ? formatLongDate(new Date(iso)) : null);

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const me = useMe();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={me.isRefetching}
            onRefresh={() => void me.refetch()}
            colors={[colors.primary]}
          />
        }
      >
        <SegmentedControl
          accessibilityLabel="Budget or Profile"
          size="large"
          value="profile"
          options={[
            { value: 'budget', label: 'Budget' },
            { value: 'profile', label: 'Profile' },
          ]}
          onChange={(v) => {
            if (v === 'budget') router.navigate('/budget');
          }}
        />

        <AppText variant="pageTitle" accessibilityRole="header">
          Profile
        </AppText>

        {me.isPending ? (
          <LoadingBlocks label="Loading profile" heights={[72, 64, 150]} />
        ) : me.isError ? (
          <ErrorState
            message={me.error.message}
            onRetry={() => me.refetch()}
            retrying={me.isFetching}
          />
        ) : (
          <ProfileDetails me={me.data} />
        )}

        <LogOutCard />
      </ScrollView>
      <BottomNav
        active="budget"
        bottomInset={insets.bottom}
        onSelect={(tab) => router.navigate(tabHref[tab])}
      />
    </View>
  );
}

function ProfileDetails({ me }: { me: Me }) {
  const name = me.full_name?.trim() || null;
  const consent = dateOrNull(me.data_consent_at);
  const since = dateOrNull(me.created_at);
  return (
    <>
      <View style={styles.identity}>
        <View style={styles.avatar} accessible={false} importantForAccessibility="no">
          <AppText style={styles.avatarText}>{initialOf(name, me.email)}</AppText>
        </View>
        <View style={styles.flex}>
          <AppText variant="sectionTitle" numberOfLines={1}>
            {name ?? 'No name yet'}
          </AppText>
          <AppText variant="body" numberOfLines={1}>
            {me.email ?? 'No email on file'}
          </AppText>
        </View>
      </View>

      <Section title="Notifications">
        <Pressable
          onPress={() => router.push({ pathname: '/notifications', params: { from: 'profile' } })}
          accessibilityRole="button"
          accessibilityLabel="Notification settings. Budget alerts, restock, shopping and meal reminders, muted items"
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <View style={styles.iconTile}>
            <BellIcon size={20} color={colors.primaryChipTextAlt} />
          </View>
          <View style={styles.flex}>
            <AppText variant="bodyLarge" color={colors.text}>
              Notification settings
            </AppText>
            <AppText variant="meta">Budget alerts, restock, shopping and meal reminders</AppText>
          </View>
          <ChevronRightIcon size={20} color={colors.textMuted} />
        </Pressable>
      </Section>

      <Section title="Account & data">
        <InfoRow label="Currency" value="Philippine peso (₱)" />
        <InfoRow
          label="Data processing consent"
          value={consent ? `Given ${consent}` : 'Not recorded'}
          divider
        />
        {since ? <InfoRow label="Member since" value={since} divider /> : null}
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="eyebrow" color={colors.textMuted} accessibilityRole="header">
        {title}
      </AppText>
      <Card size="list" padding={0} style={styles.group}>
        {children}
      </Card>
    </View>
  );
}

function InfoRow({ label, value, divider }: { label: string; value: string; divider?: boolean }) {
  return (
    <View
      style={[styles.row, divider && styles.divider]}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <AppText variant="bodyLarge" color={colors.text} style={styles.flex}>
        {label}
      </AppText>
      <AppText variant="body" style={styles.value}>
        {value}
      </AppText>
    </View>
  );
}

function LogOutCard() {
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
    <Card size="list" padding={0} style={styles.group}>
      <Pressable
        onPress={onLogOut}
        disabled={signingOut}
        accessibilityRole="button"
        accessibilityLabel="Log out"
        accessibilityState={{ busy: signingOut, disabled: signingOut }}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <AppText variant="bodyLarge" color={colors.text} style={styles.flex}>
          {signingOut ? 'Logging out…' : 'Log out'}
        </AppText>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  flex: { flex: 1 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryAction,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...font(700), fontSize: 24, color: colors.textOnPrimary },
  section: { gap: spacing.sm },
  group: { overflow: 'hidden' },
  row: {
    minHeight: sizes.buttonSecondary + spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.surfaceSubtle },
  iconTile: {
    width: sizes.listIconTile,
    height: sizes.listIconTile,
    borderRadius: radius.iconTile,
    backgroundColor: colors.primaryChipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: { textAlign: 'right', flexShrink: 1 },
});
