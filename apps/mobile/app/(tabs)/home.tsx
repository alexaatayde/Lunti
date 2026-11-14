/**
 * Home (Home.html). Build step 3 shows the parts backed by real data: the budget card and
 * spending by category. Pantry pulse and "Use these next" arrive with pantry (step 7).
 */
import { router } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useBudgetStatus,
  useNotifications,
  useTransactionSummary,
  type BudgetStatus,
  type TransactionSummary,
} from '../../src/api/hooks';
import {
  AppHeader,
  AppText,
  Badge,
  Button,
  Card,
  Fab,
  PageTitle,
  ProgressBar,
  TintCard,
  BudgetIcon,
} from '../../src/components';
import {
  featuredBudget,
  levelBadge,
  progressTone,
  progressValue,
  remainingText,
} from '../../src/features/money/budgetDisplay';
import { categoryColor } from '../../src/features/money/CategoryIcon';
import { ErrorState, LoadingBlocks } from '../../src/features/money/StateViews';
import { currentMonth, formatMonth, monthRange } from '../../src/lib/dates';
import { formatMoney, isNegativeMoney } from '../../src/lib/money';
import { colors, font, radius, sizes, spacing } from '../../src/theme';

const PERIOD_NAME = { daily: "Today's", weekly: "This week's", monthly: '', custom: '' } as const;

const FAB_BOTTOM = spacing.lg;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const month = currentMonth();
  const budgets = useBudgetStatus();
  const summary = useTransactionSummary(monthRange(month));
  const featured = budgets.data ? featuredBudget(budgets.data) : undefined;
  const notifications = useNotifications();

  const refresh = () => {
    budgets.refetch();
    summary.refetch();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <AppHeader
        onAvatarPress={() => router.push('/profile')}
        onBellPress={() =>
          router.push({ pathname: '/notifications', params: { from: 'home' } })
        }
        unreadCount={notifications.data?.unread_count ?? 0}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={budgets.isRefetching || summary.isRefetching}
            onRefresh={refresh}
            colors={[colors.primary]}
          />
        }
      >
        <PageTitle eyebrow="Your money, in good shape" title="Today, at a glance" />

        {budgets.isPending ? (
          <LoadingBlocks label="Loading your budget" heights={[260]} />
        ) : budgets.isError ? (
          <ErrorState
            message={budgets.error.message}
            onRetry={() => budgets.refetch()}
            retrying={budgets.isFetching}
          />
        ) : featured ? (
          <BudgetHero status={featured} />
        ) : (
          <TintCard style={styles.hero}>
            <AppText style={styles.heroEyebrow}>No budget yet</AppText>
            <AppText variant="bodyLarge">
              Set a monthly limit and Lunti shows what&apos;s left and a safe daily pace, from your
              saved transactions.
            </AppText>
            <Button label="Set a budget" onPress={() => router.push('/budget/new')} />
          </TintCard>
        )}

        <View>
          <AppText variant="sectionTitle" accessibilityRole="header">
            Spending by category
          </AppText>
          <AppText variant="meta">{formatMonth(month)} · all transactions</AppText>
        </View>
        {summary.isPending ? (
          <LoadingBlocks label="Loading spending" heights={[200]} />
        ) : summary.isError ? (
          <ErrorState
            message={summary.error.message}
            onRetry={() => summary.refetch()}
            retrying={summary.isFetching}
          />
        ) : (
          <SpendingCard
            summary={summary.data}
            cap={
              featured && !featured.budget.category && featured.budget.period_type === 'monthly'
                ? featured
                : undefined
            }
          />
        )}
      </ScrollView>
      <Fab
        label="Scan receipt"
        onPress={() => router.push('/scan/camera')}
        // The tab bar sits below this screen (not over it), so the FAB only needs a small gap.
        style={styles.fab}
      />
    </View>
  );
}

function BudgetHero({ status }: { status: BudgetStatus }) {
  const badge = levelBadge(status);
  const over = isNegativeMoney(status.remaining);
  const prefix = PERIOD_NAME[status.budget.period_type];
  const name =
    status.budget.period_type === 'monthly'
      ? `${formatMonth(currentMonth())} ${status.budget.label}`
      : `${prefix} ${status.budget.label}`.trim();
  const pace =
    status.level === 'exceeded'
      ? { text: "You've gone over this budget", color: colors.dangerText }
      : status.level === 'near'
        ? { text: "You're close to the limit", color: colors.warnText }
        : status.on_pace
          ? { text: "You're right on a steady pace", color: colors.primary }
          : { text: "You're spending a little faster than planned", color: colors.warnText };

  return (
    <Pressable
      onPress={() => router.navigate('/budget')}
      accessibilityRole="button"
      accessibilityLabel={`${name} budget: ${formatMoney(status.spent)} spent of ${formatMoney(status.budget.limit_amount)}, ${remainingText(status.remaining)}. ${pace.text}. Open budgets`}
    >
      <TintCard style={styles.hero} padding={spacing.xl}>
        <View style={styles.heroTop}>
          <View style={styles.flex}>
            <AppText style={styles.heroEyebrow}>{name} budget</AppText>
            <View style={styles.spentRow}>
              <AppText style={styles.spent} adjustsFontSizeToFit numberOfLines={1}>
                {formatMoney(status.spent)}
              </AppText>
              <AppText variant="bodyLarge"> spent so far</AppText>
            </View>
          </View>
          <View style={styles.heroIcon}>
            <BudgetIcon active size={24} />
          </View>
        </View>

        <View style={styles.capRow}>
          <AppText variant="bodyLarge">
            {status.budget.period_type === 'monthly' ? 'Monthly' : 'Budget'} cap
          </AppText>
          <AppText style={styles.cap}>{formatMoney(status.budget.limit_amount)}</AppText>
        </View>
        <ProgressBar
          value={progressValue(status)}
          tone={progressTone(status)}
          size="large"
          accessibilityLabel={`${status.percent_used}% of the cap used`}
        />

        <View style={styles.figures}>
          <View style={styles.flex}>
            <AppText variant="body">{over ? 'Over by' : 'Still available'}</AppText>
            <AppText style={[styles.figure, over && styles.overFigure]}>
              {over ? remainingText(status.remaining).replace('Over by ', '') : formatMoney(status.remaining)}
            </AppText>
          </View>
          <View style={styles.flex}>
            <AppText variant="body">Safe daily pace</AppText>
            <View style={styles.spentRow}>
              <AppText style={styles.figure}>{formatMoney(status.safe_daily_amount ?? '0')}</AppText>
              <AppText variant="meta">/day</AppText>
            </View>
          </View>
        </View>

        <View style={styles.paceRow}>
          <View style={[styles.dot, { backgroundColor: pace.color }]} />
          <AppText variant="bodyLarge" color={colors.text} style={styles.flex}>
            {pace.text}
          </AppText>
          {badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
        </View>
      </TintCard>
    </Pressable>
  );
}

function SpendingCard({ summary, cap }: { summary: TransactionSummary; cap?: BudgetStatus }) {
  if (summary.count === 0) {
    return (
      <Card>
        <AppText variant="cardTitle">Nothing spent yet this month</AppText>
        <AppText variant="body">Your spending shows up here as soon as you save an expense.</AppText>
        <Button
          label="Add expense"
          variant="secondary"
          onPress={() => router.push({ pathname: '/expense-form', params: { mode: 'add' } })}
          style={styles.cardButton}
        />
      </Card>
    );
  }
  return (
    <Card style={styles.spending} padding={spacing.xl}>
      <View style={styles.spendingTop}>
        <View style={[styles.spentRow, styles.flex]}>
          <AppText style={styles.total}>{formatMoney(summary.total)}</AppText>
          <AppText variant="body"> spent this month</AppText>
        </View>
        {cap ? <Badge label={`${cap.percent_used}% of cap`} /> : null}
      </View>
      {summary.by_category.map((row) => (
        <View
          key={row.category.id}
          style={styles.categoryRow}
          accessible
          accessibilityLabel={`${row.category.name}: ${formatMoney(row.total)}, ${row.share_pct}% of spending`}
        >
          <View style={styles.categoryLine}>
            <View style={[styles.dot, { backgroundColor: categoryColor(row.category.icon) }]} />
            <AppText variant="bodyLarge" color={colors.text} style={styles.flex}>
              {row.category.name}
            </AppText>
            <AppText style={styles.categoryAmount}>{formatMoney(row.total)}</AppText>
            <AppText style={styles.share}>{row.share_pct}%</AppText>
          </View>
          <View style={styles.shareTrack}>
            <View
              style={[
                styles.shareFill,
                {
                  width: `${Math.min(100, row.share_pct)}%`,
                  backgroundColor: categoryColor(row.category.icon),
                },
              ]}
            />
          </View>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.sm,
    gap: spacing.xl,
    // Room to scroll the last row clear of the FAB.
    paddingBottom: FAB_BOTTOM + sizes.fab + spacing.lg,
  },
  fab: { bottom: FAB_BOTTOM },
  flex: { flex: 1 },
  hero: { gap: spacing.md, borderRadius: radius.pageCard },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  heroEyebrow: {
    ...font(700),
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.iconTileLarge,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spentRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
  spent: { ...font(900), fontSize: 34, lineHeight: 40, letterSpacing: -0.85, color: colors.text },
  capRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cap: { ...font(800), fontSize: 15, color: colors.text },
  figures: { flexDirection: 'row', gap: spacing.lg },
  figure: { ...font(900), fontSize: 22, lineHeight: 28, color: colors.primaryDeep },
  overFigure: { color: colors.dangerText },
  paceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderTint,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  spending: { gap: spacing.lg },
  spendingTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  total: { ...font(900), fontSize: 26, lineHeight: 32, color: colors.text },
  categoryRow: { gap: spacing.sm },
  categoryLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  categoryAmount: { ...font(800), fontSize: 15, color: colors.text },
  share: { ...font(500), fontSize: 11, color: colors.textMuted, minWidth: 30, textAlign: 'right' },
  // Home.html: 6 px bar in the category's color.
  shareTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  shareFill: { height: '100%', borderRadius: radius.pill },
  cardButton: { marginTop: spacing.md },
});
