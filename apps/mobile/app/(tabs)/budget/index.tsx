/**
 * Budget tab (Budget.html, SRS 3.1.3). Budget.html is from the earlier visual generation, so
 * its layout is kept but drawn with the current tokens (DESIGN_HANDOFF.md §6).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBudgetStatus, useDeleteBudget, type BudgetStatus } from '../../../src/api/hooks';
import {
  AlertDialog,
  AppText,
  Badge,
  Button,
  EditIcon,
  PlusIcon,
  ProgressBar,
  SegmentedControl,
  TrashIcon,
} from '../../../src/components';
import {
  levelBadge,
  periodText,
  progressTone,
  progressValue,
  remainingText,
  usageText,
} from '../../../src/features/money/budgetDisplay';
import { EmptyState, ErrorState, LoadingBlocks } from '../../../src/features/money/StateViews';
import { formatMoney, isNegativeMoney } from '../../../src/lib/money';
import { showToast } from '../../../src/stores/toast';
import { colors, font, radius, spacing } from '../../../src/theme';

const newBudget = () => router.push('/budget/new');
const editBudget = (id: string) => router.push({ pathname: '/budget/new', params: { id } });

export default function BudgetScreen() {
  const insets = useSafeAreaInsets();
  const statuses = useBudgetStatus();
  const remove = useDeleteBudget();
  const [toDelete, setToDelete] = useState<BudgetStatus | null>(null);

  const onDelete = async () => {
    if (!toDelete) return;
    try {
      await remove.mutateAsync(toDelete.budget.id);
      showToast('Budget deleted. Your transactions are kept.');
    } catch (error) {
      showToast(`Couldn't delete the budget. ${(error as Error).message}`);
    } finally {
      setToDelete(null);
    }
  };

  const overall = statuses.data?.find((s) => s.state === 'active' && !s.budget.category);
  const others = statuses.data?.filter((s) => s !== overall) ?? [];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={statuses.isRefetching}
            onRefresh={() => void statuses.refetch()}
            colors={[colors.primary]}
          />
        }
      >
        <SegmentedControl
          accessibilityLabel="Budget or Profile"
          size="large"
          value="budget"
          options={[
            { value: 'budget', label: 'Budget' },
            { value: 'profile', label: 'Profile' },
          ]}
          onChange={(v) => {
            if (v === 'profile') router.push('/profile');
          }}
        />

        <View style={styles.titleRow}>
          <AppText variant="pageTitle" accessibilityRole="header">
            Budgets
          </AppText>
          <Pressable
            onPress={newBudget}
            accessibilityRole="button"
            accessibilityLabel="New budget"
            style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}
          >
            <PlusIcon size={20} color={colors.textOnPrimary} />
            <AppText style={styles.newText}>New budget</AppText>
          </Pressable>
        </View>

        {statuses.isPending ? (
          <LoadingBlocks label="Loading budgets" heights={[120, 150, 150]} />
        ) : statuses.isError ? (
          <ErrorState
            message={statuses.error.message}
            onRetry={() => statuses.refetch()}
            retrying={statuses.isFetching}
          />
        ) : statuses.data.length === 0 ? (
          <EmptyState
            title="No budgets yet"
            message="Set a spending limit for a day, week, month or custom dates, overall or per category. Lunti tracks it from your saved transactions."
            action={<Button label="Create a budget" onPress={newBudget} />}
          />
        ) : (
          <>
            {overall ? <OverallCard status={overall} /> : null}
            {others.map((s) => (
              <BudgetCard key={s.budget.id} status={s} onDelete={() => setToDelete(s)} />
            ))}
          </>
        )}
      </ScrollView>

      <AlertDialog
        visible={!!toDelete}
        title="Delete this budget?"
        summary={
          toDelete
            ? {
                label: toDelete.budget.label,
                value: formatMoney(toDelete.budget.limit_amount),
              }
            : undefined
        }
        message="Your transactions stay. Only this spending limit and its alerts are removed."
        confirmLabel="Delete"
        cancelLabel="Keep it"
        onConfirm={onDelete}
        onCancel={() => setToDelete(null)}
        loading={remove.isPending}
      />
    </View>
  );
}

/** Overall budget hero (Budget.html "Overall"), on the primary color. */
function OverallCard({ status }: { status: BudgetStatus }) {
  const badge = levelBadge(status);
  return (
    <Pressable
      onPress={() => editBudget(status.budget.id)}
      accessibilityRole="button"
      accessibilityLabel={`Overall budget, ${usageText(status)}, ${remainingText(status.remaining)}${badge ? `, ${badge.label}` : ''}. Edit`}
      style={({ pressed }) => [styles.overall, pressed && styles.pressed]}
    >
      <View style={styles.overallHeader}>
        <AppText style={styles.overallTitle}>Overall</AppText>
        <View style={styles.overallChip}>
          <AppText style={styles.overallChipText}>{periodText(status)}</AppText>
        </View>
        {badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
      </View>
      <View style={[styles.overallTrack]}>
        <View
          style={[
            styles.overallFill,
            { width: `${Math.min(100, Math.max(0, status.percent_used))}%` },
          ]}
        />
      </View>
      <View style={styles.overallFooter}>
        <AppText style={styles.overallMeta}>
          {formatMoney(status.spent)} of {formatMoney(status.budget.limit_amount)}
        </AppText>
        <AppText style={styles.overallMeta}>{remainingText(status.remaining)}</AppText>
      </View>
    </Pressable>
  );
}

function BudgetCard({ status, onDelete }: { status: BudgetStatus; onDelete: () => void }) {
  const badge = levelBadge(status);
  const over = isNegativeMoney(status.remaining);
  const tone = progressTone(status);
  const inactive = status.state !== 'active';
  return (
    <View
      style={[
        styles.card,
        status.level === 'near' && !inactive && styles.cardWarn,
        status.level === 'exceeded' && !inactive && styles.cardDanger,
        inactive && styles.cardInactive,
      ]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleBlock}>
          <AppText variant="cardTitle" style={styles.cardTitle} numberOfLines={1}>
            {status.budget.label}
          </AppText>
          <View style={styles.tags}>
            <View style={styles.periodChip}>
              <AppText style={styles.periodText}>{periodText(status)}</AppText>
            </View>
            {badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
          </View>
        </View>
        <View style={styles.actions}>
          <RoundAction
            label={`Edit ${status.budget.label} budget`}
            onPress={() => editBudget(status.budget.id)}
            icon={<EditIcon size={18} color={colors.textStrong} />}
          />
          <RoundAction
            label={`Delete ${status.budget.label} budget`}
            onPress={onDelete}
            icon={<TrashIcon size={18} color={colors.textStrong} />}
          />
        </View>
      </View>
      <ProgressBar
        value={progressValue(status)}
        tone={tone}
        accessibilityLabel={`${status.budget.label}: ${status.percent_used}% used${badge ? `, ${badge.label}` : ''}`}
      />
      <View style={styles.cardFooter}>
        <AppText variant="meta" style={styles.usage}>
          {usageText(status)}
        </AppText>
        <AppText
          style={[
            styles.left,
            over ? styles.leftDanger : status.level === 'near' ? styles.leftWarn : null,
          ]}
        >
          {remainingText(status.remaining)}
        </AppText>
      </View>
    </View>
  );
}

function RoundAction({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.round, pressed && styles.pressed]}
    >
      {icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.screen, gap: spacing.lg, paddingBottom: spacing.xxl },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryAction,
  },
  newText: { ...font(700), fontSize: 16, color: colors.textOnPrimary },
  pressed: { opacity: 0.85 },
  overall: {
    backgroundColor: colors.primaryAction,
    borderRadius: radius.pageCard,
    padding: spacing.xl,
    gap: spacing.md,
  },
  overallHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  overallTitle: { ...font(800), fontSize: 20, color: colors.textOnPrimary },
  overallChip: {
    backgroundColor: colors.onPrimaryChip,
    borderRadius: radius.iconTile,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  overallChipText: { ...font(600), fontSize: 13, color: colors.textOnPrimary },
  overallTrack: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.onPrimaryTrack,
    overflow: 'hidden',
  },
  overallFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.onPrimaryFill },
  overallFooter: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  overallMeta: { ...font(500), fontSize: 15, color: colors.onPrimaryMuted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.pageCard,
    borderWidth: 1,
    borderColor: colors.borderInput,
    padding: spacing.xl,
    gap: spacing.md,
  },
  cardWarn: { borderColor: colors.warnBorder },
  cardDanger: { borderColor: colors.dangerBorder },
  cardInactive: { opacity: 0.75 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  cardTitleBlock: { flex: 1, gap: spacing.sm },
  cardTitle: { fontSize: 18 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  periodChip: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.iconTile,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  periodText: { ...font(500), fontSize: 13, color: colors.textBody },
  actions: { flexDirection: 'row', gap: spacing.sm },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.borderInput,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  usage: { flex: 1, fontSize: 14 },
  left: { ...font(600), fontSize: 14, color: colors.textBody },
  leftWarn: { ...font(800), color: colors.warnStrong },
  leftDanger: { ...font(800), color: colors.dangerText },
});
