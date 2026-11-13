/** TransactionDetail (TxnDetail.html) with the delete dialog (TxnDelete.html). Keeps the nav. */
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTransaction, type BudgetImpact, type TransactionDetail } from '../../src/api/hooks';
import {
  AlertDialog,
  AppText,
  Badge,
  BottomNav,
  Card,
  ChevronLeftIcon,
  Chip,
  EditIcon,
  ProgressBar,
  TintCard,
  TrashIcon,
  type TabKey,
} from '../../src/components';
import { remainingText } from '../../src/features/money/budgetDisplay';
import { CategoryIcon, categoryColor } from '../../src/features/money/CategoryIcon';
import { ErrorState, LoadingBlocks } from '../../src/features/money/StateViews';
import { useDeleteWithUndo } from '../../src/features/money/useDeleteWithUndo';
import { formatPeriod, formatRelativeDay, formatTime } from '../../src/lib/dates';
import { formatMoney, isNegativeMoney } from '../../src/lib/money';
import { colors, font, radius, spacing } from '../../src/theme';

const tabHref: Record<TabKey, Href> = {
  analytics: '/analytics',
  budget: '/budget',
  home: '/home',
  meals: '/meals',
  transactions: '/transactions',
};

function back() {
  if (router.canGoBack()) router.back();
  else router.replace('/transactions');
}

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const txn = useTransaction(id);
  const deletion = useDeleteWithUndo();
  // What the delete dialog shows. A snapshot, so the dialog never depends on the query.
  const [toDelete, setToDelete] = useState<TransactionDetail | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const onDelete = async () => {
    if (!toDelete) return;
    setDeleteError(null);
    try {
      await deletion.run(toDelete);
      setToDelete(null);
      back();
    } catch (error) {
      setToDelete(null);
      setDeleteError(error instanceof Error ? error.message : String(error));
    }
  };

  const budget = txn.data?.budgets[0];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={back}
          accessibilityRole="button"
          accessibilityLabel="Back to Transactions"
          hitSlop={8}
          style={styles.backLink}
        >
          <ChevronLeftIcon size={20} color={colors.primaryLink} />
          <AppText style={styles.backText}>Transactions</AppText>
        </Pressable>
        {txn.data ? (
          <Pressable
            onPress={() =>
              router.push({ pathname: '/expense-form', params: { mode: 'edit', id: txn.data.id } })
            }
            accessibilityRole="button"
            accessibilityLabel="Edit transaction"
            style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
          >
            <EditIcon size={16} color={colors.textStrong} />
            <AppText style={styles.editText}>Edit</AppText>
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {txn.isPending ? (
          <LoadingBlocks label="Loading transaction" heights={[180, 160, 120]} />
        ) : txn.isError ? (
          <ErrorState
            message={
              txn.error.message === "We couldn't find that."
                ? 'This transaction no longer exists.'
                : txn.error.message
            }
            onRetry={() => txn.refetch()}
            retrying={txn.isFetching}
          />
        ) : (
          <>
            <View style={styles.hero}>
              <CategoryIcon icon={txn.data.category.icon} size={52} />
              <AppText style={styles.merchant} accessibilityRole="header">
                {txn.data.merchant ?? txn.data.category.name}
              </AppText>
              <AppText style={styles.amount}>{formatMoney(txn.data.amount)}</AppText>
              <AppText variant="meta" style={styles.when}>
                {formatRelativeDay(new Date(txn.data.occurred_at))} ·{' '}
                {formatTime(new Date(txn.data.occurred_at))}
              </AppText>
              <View style={styles.chips}>
                <Chip
                  label={txn.data.category.name}
                  dotColor={categoryColor(txn.data.category.icon)}
                />
                <Badge
                  label={txn.data.source === 'receipt' ? 'Scanned receipt' : 'Manual entry'}
                  tone="neutral"
                  icon={null}
                />
              </View>
            </View>

            {txn.data.note ? (
              <Card size="list">
                <AppText variant="meta">Note</AppText>
                <AppText variant="bodyLarge" color={colors.text}>
                  {txn.data.note}
                </AppText>
              </Card>
            ) : null}

            {txn.data.items.length > 0 ? (
              <Card style={styles.items}>
                <View style={styles.itemsHeader}>
                  <AppText variant="cardTitle">Items</AppText>
                  <Badge label={`${txn.data.items.length} items`} />
                </View>
                {txn.data.items.map((item) => (
                  <View key={item.id} style={styles.itemRow}>
                    <AppText variant="bodyLarge" color={colors.text} style={styles.flex}>
                      {item.name}
                    </AppText>
                    <AppText style={styles.itemPrice}>{formatMoney(item.line_total)}</AppText>
                  </View>
                ))}
                <View style={[styles.itemRow, styles.totalRow]}>
                  <AppText variant="cardTitle">Total</AppText>
                  <AppText variant="cardTitle">{formatMoney(txn.data.amount)}</AppText>
                </View>
              </Card>
            ) : null}

            {budget ? <BudgetImpactCard impact={budget} /> : null}

            {deleteError ? (
              <ErrorState message={deleteError} onRetry={() => setToDelete(txn.data)} />
            ) : null}

            <Pressable
              onPress={() => setToDelete(txn.data)}
              accessibilityRole="button"
              accessibilityLabel="Delete transaction"
              style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
            >
              <TrashIcon size={18} color={colors.dangerText} />
              <AppText style={styles.deleteText}>Delete transaction</AppText>
            </Pressable>

          </>
        )}
      </ScrollView>

      {/* Outside the loading/error/data branches on purpose: it is only ever closed through
          `visible`, never unmounted while open. On Android an unmounted open Modal can leave
          its invisible window on top, swallowing every touch. */}
      <AlertDialog
        visible={toDelete !== null}
        title="Delete this transaction?"
        summary={
          toDelete
            ? {
                label: toDelete.merchant ?? toDelete.category.name,
                value: formatMoney(toDelete.amount),
              }
            : undefined
        }
        message={
          <>
            {toDelete?.budgets[0] ? (
              <>
                It will be removed from your history, and your {toDelete.budgets[0].label}{' '}
                budget goes back up to{' '}
                <AppText variant="meta" style={styles.strong}>
                  {formatMoney(toDelete.budgets[0].remaining_without_this)}
                </AppText>{' '}
                left.
              </>
            ) : (
              'It will be removed from your history.'
            )}
            {toDelete?.source === 'receipt'
              ? ' The scanned receipt and its photo are deleted too.'
              : ''}
          </>
        }
        confirmLabel="Delete"
        cancelLabel="Keep it"
        onConfirm={onDelete}
        onCancel={() => setToDelete(null)}
        loading={deletion.isPending}
      />

      <BottomNav
        active="transactions"
        bottomInset={insets.bottom}
        onSelect={(tab) => router.navigate(tabHref[tab])}
      />
    </View>
  );
}

function BudgetImpactCard({ impact }: { impact: BudgetImpact }) {
  const over = isNegativeMoney(impact.remaining);
  const period = formatPeriod(impact.period_start, impact.period_end);
  return (
    <TintCard>
      <View style={styles.impactHeader}>
        <AppText style={styles.impactEyebrow} numberOfLines={2}>
          Counts toward {impact.label} budget · {period}
        </AppText>
        <Pressable
          onPress={() => router.navigate('/budget')}
          accessibilityRole="button"
          accessibilityLabel={`View ${impact.label} budget`}
          hitSlop={10}
        >
          <AppText style={styles.viewLink}>View</AppText>
        </Pressable>
      </View>
      <View style={styles.impactRow}>
        {over ? (
          <AppText style={[styles.impactAmount, styles.overText]}>
            {remainingText(impact.remaining)}
          </AppText>
        ) : (
          <>
            <AppText style={styles.impactAmount}>{formatMoney(impact.remaining)}</AppText>
            <AppText variant="meta"> left of {formatMoney(impact.limit_amount)}</AppText>
          </>
        )}
      </View>
      <ProgressBar
        value={impact.percent_used / 100}
        tone={impact.level === 'exceeded' ? 'danger' : impact.level === 'near' ? 'warn' : 'normal'}
        size="large"
        accessibilityLabel={`${impact.label} budget: ${remainingText(impact.remaining)}`}
      />
    </TintCard>
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
  },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44 },
  backText: { ...font(600), fontSize: 16, color: colors.primaryLink },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderInput,
    backgroundColor: colors.surface,
  },
  editText: { ...font(600), fontSize: 15, color: colors.textStrong },
  pressed: { opacity: 0.8 },
  content: { paddingHorizontal: spacing.screen, paddingBottom: spacing.xxl, gap: spacing.lg },
  hero: { alignItems: 'center', gap: spacing.xs, paddingTop: spacing.sm },
  merchant: {
    ...font(800),
    fontSize: 20,
    lineHeight: 26,
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  amount: {
    ...font(900),
    fontSize: 36,
    lineHeight: 42,
    letterSpacing: -0.9,
    color: colors.text,
  },
  when: { fontSize: 13 },
  chips: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  items: { gap: spacing.sm },
  itemsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  itemPrice: { ...font(700), fontSize: 15, color: colors.text },
  totalRow: {
    paddingTop: spacing.md,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    justifyContent: 'space-between',
  },
  flex: { flex: 1 },
  impactHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  impactEyebrow: {
    ...font(700),
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.55,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  viewLink: { ...font(700), fontSize: 14, color: colors.primaryLink },
  impactRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  impactAmount: { ...font(900), fontSize: 24, lineHeight: 30, color: colors.primaryDeep },
  overText: { color: colors.dangerText },
  strong: { ...font(800), color: colors.primaryDeep },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 52,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.surface,
  },
  deleteText: { ...font(700), fontSize: 16, color: colors.dangerText },
});
