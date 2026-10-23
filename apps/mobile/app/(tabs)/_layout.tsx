import { Tabs } from 'expo-router/js-tabs';

import { BottomNav, TABS, type TabKey } from '../../src/components';
import { colors } from '../../src/theme';

export const unstable_settings = { initialRouteName: 'home' };

/** Route names in this folder → tab keys ("budget/index" → "budget"). */
const toTabKey = (routeName: string) => routeName.split('/')[0] as TabKey;

const routeNames: Record<TabKey, string> = {
  analytics: 'analytics',
  budget: 'budget/index',
  home: 'home',
  meals: 'meals/index',
  transactions: 'transactions/index',
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
      tabBar={({ state, navigateToTab, insets }) => {
        const activeRoute = state.routes[state.index];
        return (
          <BottomNav
            active={toTabKey(activeRoute.name)}
            bottomInset={insets.bottom}
            onSelect={(tab) => {
              const target = state.routes.find((r) => toTabKey(r.name) === tab);
              if (target && target.key !== activeRoute.key) navigateToTab(target.key);
            }}
          />
        );
      }}
    >
      {/* Declared in nav order so the router's tab order matches the design. */}
      {TABS.map(({ key, label }) => (
        <Tabs.Screen key={key} name={routeNames[key]} options={{ title: label }} />
      ))}
    </Tabs>
  );
}
