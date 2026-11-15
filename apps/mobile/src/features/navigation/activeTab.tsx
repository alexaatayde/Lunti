/**
 * Which bottom-nav tab a screen belongs to, from the Expo Router pathname.
 *
 * Tab roots get their selected tab from the tab navigator's own state (app/(tabs)/_layout.tsx).
 * A few screens outside the tab navigator also draw the bottom nav (DESIGN_HANDOFF.md §4: Profile
 * and Transaction detail). They use StackBottomNav, which reads the pathname, so a deep link, a
 * programmatic push or Android Back always shows the parent tab of the screen that is visible.
 */
import { router, usePathname, type Href } from 'expo-router';

import { BottomNav, type TabKey } from '../../components/BottomNav';

export const TAB_HREF: Record<TabKey, Href> = {
  analytics: '/analytics',
  budget: '/budget',
  home: '/home',
  meals: '/meals',
  transactions: '/transactions',
};

const TAB_KEYS = Object.keys(TAB_HREF) as TabKey[];

/**
 * Screens outside a tab's own path that still show a tab as their parent. Profile keeps Budget
 * selected as before (Budget's segment links to it, DESIGN_HANDOFF.md §4).
 */
const PARENT_TAB: Record<string, TabKey> = { profile: 'budget' };

/**
 * "/transactions/abc" → "transactions", "/meals/pantry" → "meals", "/profile" → "budget".
 * Paths that belong to no tab (modals, auth, dev) → null, so no tab is shown as selected.
 */
export function tabForPathname(pathname: string): TabKey | null {
  const first = pathname.split(/[?#]/)[0].split('/').filter(Boolean)[0] ?? '';
  if ((TAB_KEYS as string[]).includes(first)) return first as TabKey;
  return PARENT_TAB[first] ?? null;
}

/** The bottom nav for a screen outside the tab navigator; selection follows the router. */
export function StackBottomNav({ bottomInset }: { bottomInset?: number }) {
  const pathname = usePathname();
  return (
    <BottomNav
      active={tabForPathname(pathname)}
      bottomInset={bottomInset}
      onSelect={(tab) => router.navigate(TAB_HREF[tab])}
    />
  );
}
