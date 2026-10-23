import type { ComponentType } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, font, sizes } from '../theme';
import { AppText } from './AppText';
import {
  AnalyticsIcon,
  BudgetIcon,
  HomeIcon,
  MealsIcon,
  TransactionsIcon,
  type NavIconProps,
} from './icons';

export type TabKey = 'analytics' | 'budget' | 'home' | 'meals' | 'transactions';

type TabItem = { key: TabKey; label: string; Icon: ComponentType<NavIconProps> };

/** Order is fixed by the design: Analytics · Budget · Home · Meals · Transactions (Home centered). */
export const TABS: readonly TabItem[] = [
  { key: 'analytics', label: 'Analytics', Icon: AnalyticsIcon },
  { key: 'budget', label: 'Budget', Icon: BudgetIcon },
  { key: 'home', label: 'Home', Icon: HomeIcon },
  { key: 'meals', label: 'Meals', Icon: MealsIcon },
  { key: 'transactions', label: 'Transactions', Icon: TransactionsIcon },
];

export type BottomNavProps = {
  active: TabKey;
  onSelect: (tab: TabKey) => void;
  /** Extra space for the Android gesture bar / iOS home indicator. */
  bottomInset?: number;
};

/** 88 px tab bar (NavBar.html). Purely presentational; the router wires `onSelect`. */
export function BottomNav({ active, onSelect, bottomInset = 0 }: BottomNavProps) {
  const paddingBottom = Math.max(14, bottomInset);
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.nav, { height: sizes.navHeight - 14 + paddingBottom, paddingBottom }]}
    >
      {TABS.map(({ key, label, Icon }) => {
        const isActive = key === active;
        return (
          <Pressable
            key={key}
            onPress={() => onSelect(key)}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: isActive }}
            testID={`tab-${key}`}
            style={styles.item}
          >
            <View style={[styles.pill, isActive && styles.pillActive]}>
              <Icon active={isActive} />
            </View>
            <AppText
              numberOfLines={1}
              style={[styles.label, isActive ? styles.labelActive : styles.labelInactive]}
            >
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.borderTint,
    paddingTop: 6,
    paddingHorizontal: 4,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingTop: 6,
    paddingBottom: 4,
  },
  pill: {
    width: sizes.navPill.width,
    height: sizes.navPill.height,
    borderRadius: sizes.navPill.height / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: { backgroundColor: colors.navActiveBg },
  label: { fontSize: 11, lineHeight: 14 },
  labelActive: { ...font(700), color: colors.navActive },
  labelInactive: { ...font(500), color: colors.navInactive },
});
