/**
 * Notifications (Notifications.html, SRS 3.7.5): budget alerts, restock reminders and shopping
 * reminders from GET /notifications, newest first. Opening one marks it read. Restock cards can
 * be answered here while the suggestion is still open.
 *
 * Added beyond the design (flagged for review): the notification switches at the bottom
 * (user_preferences), since Profile isn't built yet.
 */
import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMutedProducts,
  useNotifications,
  useUnmuteProduct,
  usePreferences,
  useUpdatePreferences,
  type AppNotification,
  type Preferences,
} from '../src/api/hooks';
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  AppText,
  BagIcon,
  Card,
  ChevronLeftIcon,
  ListIcon,
} from '../src/components';
import {
  answeredText,
  isOpen,
  notificationTone,
  timeAgo,
  type NotificationTone,
} from '../src/features/lists/display';
import { SuggestionActions } from '../src/features/lists/SuggestionActions';
import { EmptyState, ErrorState, LoadingBlocks } from '../src/features/money/StateViews';
import { showToast } from '../src/stores/toast';
import { colors, font, radius, spacing } from '../src/theme';

const TONES: Record<NotificationTone, { bg: string; fg: string; border: string; icon: ReactNode }> =
  {
    danger: {
      bg: colors.dangerBg,
      fg: colors.dangerText,
      border: colors.dangerBorder,
      icon: <AlertCircleIcon size={22} color={colors.dangerText} />,
    },
    warn: {
      bg: colors.warnBg,
      fg: colors.warnStrong,
      border: colors.warnBorder,
      icon: <AlertTriangleIcon size={22} color={colors.warnStrong} />,
    },
    restock: {
      bg: colors.primaryChipBg,
      fg: colors.primaryChipText,
      border: colors.borderInput,
      icon: <BagIcon size={22} color={colors.primaryChipText} />,
    },
    list: {
      bg: colors.primaryChipBg,
      fg: colors.primaryChipText,
      border: colors.borderInput,
      icon: <ListIcon size={22} color={colors.primaryChipText} />,
    },
  };

const ACTION: Record<string, string> = {
  budget: 'View budget',
  shopping: 'Open list',
  replenishment: 'Open list',
};

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const notifications = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const unread = notifications.data?.unread_count ?? 0;

  const open = (n: AppNotification, href?: string | null) => {
    if (!n.read_at) markRead.mutate(n.id);
    if (href) router.push(href as Href);
  };

  const items = notifications.data?.items ?? [];
  const fresh = items.filter((n) => !n.read_at);
  const earlier = items.filter((n) => n.read_at);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={styles.back}
        >
          <ChevronLeftIcon size={22} color={colors.text} />
          <AppText variant="body" color={colors.text}>
            Home
          </AppText>
        </Pressable>
        <AppText variant="cardTitle" accessibilityRole="header" style={styles.title}>
          Notifications
        </AppText>
        <Pressable
          onPress={() =>
            markAll.mutate(undefined, {
              onError: (e) => showToast(`Couldn't mark them read. ${e.message}`),
            })
          }
          disabled={unread === 0 || markAll.isPending}
          accessibilityRole="button"
          accessibilityLabel="Mark all read"
          accessibilityState={{ disabled: unread === 0 }}
          style={[styles.markAll, unread === 0 && styles.disabled]}
        >
          <AppText style={styles.markAllText}>Mark all read</AppText>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]}
        refreshControl={
          <RefreshControl
            refreshing={notifications.isRefetching}
            onRefresh={() => void notifications.refetch()}
            colors={[colors.primary]}
          />
        }
      >
        {notifications.isPending ? (
          <LoadingBlocks label="Loading notifications" heights={[120, 120, 120]} />
        ) : notifications.isError ? (
          <ErrorState
            message={notifications.error.message}
            onRetry={() => notifications.refetch()}
            retrying={notifications.isFetching}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="No notifications yet"
            message="Budget alerts, restock reminders and shopping reminders will show up here."
          />
        ) : (
          <>
            {fresh.length > 0 ? (
              <Section title={`New · ${fresh.length}`} items={fresh} onOpen={open} />
            ) : null}
            {earlier.length > 0 ? <Section title="Earlier" items={earlier} onOpen={open} /> : null}
          </>
        )}
        <PreferencesCard />
        <MutedCard />
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: AppNotification[];
  onOpen: (n: AppNotification, href?: string | null) => void;
}) {
  return (
    <View style={styles.section}>
      <AppText variant="eyebrow" color={colors.textBody} accessibilityRole="header">
        {title}
      </AppText>
      {items.map((n) => (
        <NotificationCard key={n.id} notification={n} onOpen={onOpen} />
      ))}
    </View>
  );
}

function NotificationCard({
  notification: n,
  onOpen,
}: {
  notification: AppNotification;
  onOpen: (n: AppNotification, href?: string | null) => void;
}) {
  const tone = TONES[notificationTone(n)];
  const highlighted = !n.read_at && n.type === 'budget';
  const suggestion = n.suggestion;
  return (
    <Card style={[styles.card, highlighted && { borderColor: tone.border }]}>
      <Pressable
        onPress={() => onOpen(n)}
        accessibilityRole="button"
        accessibilityLabel={`${n.read_at ? '' : 'Unread. '}${n.title}. ${n.body}. ${timeAgo(n.created_at)}`}
        style={styles.cardRow}
      >
        <View style={[styles.iconTile, { backgroundColor: tone.bg }]}>{tone.icon}</View>
        <View style={styles.flex}>
          <View style={styles.titleRow}>
            <AppText variant="cardTitle" style={styles.flex}>
              {n.title}
            </AppText>
            <AppText variant="meta">{timeAgo(n.created_at)}</AppText>
          </View>
          <AppText variant="body">{n.body}</AppText>
        </View>
      </Pressable>
      <View style={styles.actions}>
        {n.type === 'replenishment' && suggestion && isOpen(suggestion) ? (
          <SuggestionActions suggestion={suggestion} />
        ) : (
          <>
            {suggestion && answeredText(suggestion) ? (
              <AppText variant="meta">{answeredText(suggestion)}</AppText>
            ) : null}
            {n.deep_link && ACTION[n.type] ? (
              <Pressable
                onPress={() => onOpen(n, n.deep_link)}
                accessibilityRole="link"
                accessibilityLabel={`${ACTION[n.type]}: ${n.title}`}
                style={styles.link}
              >
                <AppText style={styles.linkText}>{ACTION[n.type]}</AppText>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </Card>
  );
}

const SWITCHES: { key: keyof Preferences; label: string }[] = [
  { key: 'notify_budget', label: 'Budget alerts' },
  { key: 'notify_replenishment', label: 'Restock reminders' },
  { key: 'notify_shopping', label: 'Shopping reminders' },
];

function PreferencesCard() {
  const prefs = usePreferences();
  const update = useUpdatePreferences();
  if (!prefs.data) return null;
  const data = prefs.data;
  return (
    <Card style={styles.prefs}>
      <AppText variant="cardTitle" accessibilityRole="header">
        Notify me about
      </AppText>
      {SWITCHES.map(({ key, label }) => (
        <View key={key} style={styles.switchRow}>
          <AppText variant="body" color={colors.text} style={styles.flex}>
            {label}
          </AppText>
          <Switch
            value={Boolean(data[key])}
            disabled={update.isPending}
            accessibilityLabel={label}
            trackColor={{ true: colors.primary, false: colors.track }}
            onValueChange={(value) =>
              update.mutate(
                { ...data, [key]: value },
                { onError: (e) => showToast(`Couldn't save. ${e.message}`) },
              )
            }
          />
        </View>
      ))}
    </Card>
  );
}

/** Products muted with "Don't remind me", so they can be turned back on at any time. */
function MutedCard() {
  const muted = useMutedProducts();
  const unmute = useUnmuteProduct();
  if (!muted.data || muted.data.length === 0) return null;
  return (
    <Card style={styles.prefs}>
      <View>
        <AppText variant="cardTitle" accessibilityRole="header">
          Muted items
        </AppText>
        <AppText variant="meta">You won&apos;t get restock reminders for these.</AppText>
      </View>
      {muted.data.map((m) => (
        <View key={m.product.id} style={styles.switchRow}>
          <AppText variant="body" color={colors.text} style={styles.flex}>
            {m.product.name}
          </AppText>
          <Pressable
            onPress={() =>
              unmute.mutate(m.product.id, {
                onSuccess: () => showToast(`Reminders for ${m.product.name} are back on.`),
                onError: (e) => showToast(`Couldn't turn them back on. ${e.message}`),
              })
            }
            disabled={unmute.isPending}
            accessibilityRole="button"
            accessibilityLabel={`Turn reminders back on for ${m.product.name}`}
            style={styles.link}
          >
            <AppText style={styles.linkText}>Turn back on</AppText>
          </Pressable>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44 },
  title: { fontSize: 18 },
  markAll: { minHeight: 44, justifyContent: 'center' },
  markAllText: { ...font(700), fontSize: 15, color: colors.primaryLink },
  disabled: { opacity: 0.4 },
  content: { padding: spacing.screen, gap: spacing.xl },
  section: { gap: spacing.md },
  flex: { flex: 1 },
  card: { gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  cardRow: { flexDirection: 'row', gap: spacing.md },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: radius.iconTile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  actions: { paddingLeft: 44 + spacing.md, gap: spacing.sm },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { ...font(700), fontSize: 15, color: colors.primaryLink },
  prefs: { gap: spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: spacing.md },
});
