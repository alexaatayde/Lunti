/**
 * Temporary screen used by every route in the navigation skeleton (build step 1).
 * Real screens from design/ replace these one feature at a time.
 */
import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader, AppText, BottomNav, Button, PageTitle, type TabKey } from '../../components';
import { colors, spacing } from '../../theme';

export type PlaceholderLink = { label: string; href: Href; replace?: boolean };

export type PlaceholderScreenProps = {
  title: string;
  eyebrow?: string;
  /** Design file this route will be built from, e.g. "Home" → design/screens/Home.html. */
  designFile?: string;
  /** Buttons that follow the navigation map in DESIGN_HANDOFF.md §4. */
  links?: PlaceholderLink[];
  /** Show a Back button (modals and pushed screens). */
  canGoBack?: boolean;
  /**
   * Draw the bottom nav on a screen outside the tab navigator (Profile, Transaction detail).
   * Tab roots get the nav from the tab layout instead.
   */
  nav?: TabKey;
  /** Leave room for the tab bar (tab roots). */
  inTabs?: boolean;
  /** Working pieces added before the full screen is built (e.g. Log out on Profile). */
  children?: ReactNode;
};

const tabHref: Record<TabKey, Href> = {
  analytics: '/analytics',
  budget: '/budget',
  home: '/home',
  meals: '/meals',
  transactions: '/transactions',
};

export function PlaceholderScreen({
  title,
  eyebrow = 'Placeholder',
  designFile,
  links = [],
  canGoBack,
  nav,
  inTabs,
  children,
}: PlaceholderScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <AppHeader onAvatarPress={() => router.push('/profile')} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: inTabs || nav ? spacing.xxl : spacing.xxl + insets.bottom },
        ]}
      >
        <PageTitle eyebrow={eyebrow} title={title} />
        {designFile ? (
          <AppText variant="meta">
            Design: design/screenshots/{designFile}.png · design/screens/{designFile}.html
          </AppText>
        ) : null}
        {children}
        <View style={styles.links}>
          {links.map((link) => (
            <Button
              key={link.label}
              label={link.label}
              variant="secondary"
              onPress={() => (link.replace ? router.replace(link.href) : router.push(link.href))}
            />
          ))}
          {canGoBack ? (
            <Button
              label="Back"
              variant="ghost"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
            />
          ) : null}
        </View>
      </ScrollView>
      {nav ? (
        <BottomNav
          active={nav}
          bottomInset={insets.bottom}
          onSelect={(tab) => router.navigate(tabHref[tab])}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screen, paddingTop: spacing.md, gap: spacing.lg },
  links: { gap: spacing.md, marginTop: spacing.sm },
});
