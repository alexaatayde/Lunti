import type { ComponentType } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, font, radius, sizes, spacing } from '../theme';
import { AppText, NAV_FONT_SCALE } from './AppText';
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
  /** Selected tab; null when the visible screen belongs to no tab. */
  active: TabKey | null;
  onSelect: (tab: TabKey) => void;
  /** Extra space for the Android gesture bar / iOS home indicator. */
  bottomInset?: number;
};

/**
 * 88 px tab bar (NavBar.html). Purely presentational; the router wires `active` and `onSelect`.
 *
 * The active item sits on a rounded `navActiveBg` highlight that wraps its icon and label (in
 * place of the design's icon-only 56×32 pill, so the whole item reads as selected). Selection is
 * never color alone: the label turns bold, the icon's leaves fill, and TalkBack hears "selected".
 */
export function BottomNav({ active, onSelect, bottomInset = 0 }: BottomNavProps) {
  const paddingBottom = Math.max(14, bottomInset);
  return (
    <View
      accessibilityRole="tablist"
      testID="bottom-nav"
      style={[styles.nav, { minHeight: sizes.navHeight - 14 + paddingBottom, paddingBottom }]}
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
            <View
              testID={`tab-${key}-highlight`}
              style={[styles.highlight, isActive && styles.highlightActive]}
            >
              <View style={styles.icon}>
                <Icon active={isActive} />
              </View>
              <AppText
                maxFontSizeMultiplier={NAV_FONT_SCALE}
                numberOfLines={1}
                // Safety net for narrow phones: shrink a long label slightly rather than cut it.
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                style={[styles.label, isActive ? styles.labelActive : styles.labelInactive]}
              >
                {label}
              </AppText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Highlight corner radius: the design's 16 dp large-tile radius, consistent with cards and chips. */
export const NAV_HIGHLIGHT_RADIUS = radius.iconTileLarge;

const styles = StyleSheet.create({
  nav: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.borderTint,
    paddingTop: 6,
    paddingHorizontal: spacing.xs,
  },
  item: {
    flex: 1,
    minHeight: sizes.touchTargetMaterial,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxs,
    paddingVertical: spacing.xxs,
  },
  highlight: {
    alignItems: 'center',
    gap: spacing.xxs,
    paddingVertical: 6,
    borderRadius: NAV_HIGHLIGHT_RADIUS,
  },
  highlightActive: { backgroundColor: colors.navActiveBg },
  icon: { height: 24, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, lineHeight: 14 },
  labelActive: { ...font(700), color: colors.navActive },
  labelInactive: { ...font(500), color: colors.navInactive },
});
