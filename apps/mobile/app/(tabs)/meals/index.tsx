/**
 * Meals tab (Meals.html, SRS 3.1.9–3.1.10): insights, the best recipe for what's in the pantry,
 * more ideas, and links to Pantry and the Grocery list.
 *
 * Left out on purpose (no data, flagged for review): recipe photos, "takeout savings" and the
 * "bulk restock … saved" card — Lunti never shows savings it can't calculate.
 */
import { router, type Href } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useDismissInsight,
  useInsights,
  useRecommendations,
  type RecipeSummary,
} from '../../../src/api/hooks';
import {
  AppHeader,
  AppText,
  Card,
  ChevronRightIcon,
  CloseIcon,
  InfoIcon,
  TintCard,
} from '../../../src/components';
import { engineLabel, missingText, recipeMeta } from '../../../src/features/meals/display';
import { RecipeCard } from '../../../src/features/meals/RecipeCard';
import { EmptyState, ErrorState, LoadingBlocks } from '../../../src/features/money/StateViews';
import { formatMoney } from '../../../src/lib/money';
import { showToast } from '../../../src/stores/toast';
import { colors, font, radius, spacing } from '../../../src/theme';

export default function MealsScreen() {
  const insets = useSafeAreaInsets();
  const recs = useRecommendations();
  const insights = useInsights();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <AppHeader onAvatarPress={() => router.push('/profile')} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={recs.isRefetching || insights.isRefetching}
            onRefresh={() => {
              void recs.refetch();
              void insights.refetch();
            }}
            colors={[colors.primary]}
          />
        }
      >
        <View>
          <AppText variant="eyebrow">A little more with what you have</AppText>
          <AppText variant="pageTitle" accessibilityRole="header">
            Ideas & savings
          </AppText>
          <AppText variant="body">Small, thoughtful choices add up.</AppText>
        </View>

        <InsightsSection query={insights} />

        {recs.isPending ? (
          <LoadingBlocks label="Loading recipe ideas" heights={[230, 120]} />
        ) : recs.isError ? (
          <ErrorState
            message={recs.error.message}
            onRetry={() => recs.refetch()}
            retrying={recs.isFetching}
          />
        ) : recs.data.items.length === 0 ? (
          <EmptyState
            title="No recipe ideas yet"
            message="Scan your grocery receipts to fill your pantry. Lunti then suggests dishes that use what you already have."
          />
        ) : (
          <>
            <View>
              <AppText variant="sectionTitle" accessibilityRole="header">
                Cook what&apos;s here
              </AppText>
              <AppText variant="meta">The best match for your pantry</AppText>
            </View>
            <RecipeCard recipe={recs.data.items[0]} />
            {recs.data.items.length > 1 ? <MoreIdeas items={recs.data.items.slice(1)} /> : null}
            {recs.data.over_budget_count > 0 && recs.data.budget_remaining ? (
              <View style={styles.note}>
                <InfoIcon size={14} color={colors.textMuted} />
                <AppText variant="meta" style={styles.flex}>
                  {recs.data.over_budget_count} more{' '}
                  {recs.data.over_budget_count === 1 ? 'idea is' : 'ideas are'} hidden: the known
                  estimated cost of their missing items is more than the{' '}
                  {formatMoney(recs.data.budget_remaining)} left in your {recs.data.budget_label}{' '}
                  budget.
                </AppText>
              </View>
            ) : null}
          </>
        )}

        <Card size="list" padding={0}>
          <LinkRow
            label="Pantry"
            hint="What you have, and what to use first"
            href="/meals/pantry"
          />
          <LinkRow label="Grocery list" hint="Your next shop" href="/meals/grocery-list" border />
        </Card>
      </ScrollView>
    </View>
  );
}

function InsightsSection({ query }: { query: ReturnType<typeof useInsights> }) {
  const dismiss = useDismissInsight();
  if (query.isPending) return <LoadingBlocks label="Loading insights" heights={[90]} />;
  if (query.isError) {
    return (
      <ErrorState
        message={`Couldn't load insights. ${query.error.message}`}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  if (query.data.need_more_data) {
    return (
      <TintCard style={styles.insight}>
        <AppText variant="eyebrow">Insights</AppText>
        <AppText variant="body">{query.data.placeholder}</AppText>
      </TintCard>
    );
  }
  return (
    <>
      {query.data.items.map((insight) => (
        <TintCard key={insight.id} style={styles.insight}>
          <View style={styles.insightTop}>
            <AppText variant="eyebrow">{engineLabel(insight)}</AppText>
            <Pressable
              onPress={() =>
                dismiss.mutate(insight.id, {
                  onError: (e) => showToast(`Couldn't hide it. ${e.message}`),
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Hide this insight"
              hitSlop={10}
              style={styles.close}
            >
              <CloseIcon size={16} color={colors.textMuted} />
            </Pressable>
          </View>
          <AppText variant="body" color={colors.text}>
            {insight.message}
          </AppText>
        </TintCard>
      ))}
    </>
  );
}

function MoreIdeas({ items }: { items: RecipeSummary[] }) {
  return (
    <Card size="list" padding={0}>
      {items.map((r, i) => (
        <Pressable
          key={r.id}
          onPress={() => router.push(`/meals/recipe/${r.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`${r.name}, ${r.match_pct}% match, ${missingText(r)}`}
          style={({ pressed }) => [styles.row, i > 0 && styles.border, pressed && styles.pressed]}
        >
          <View style={styles.flex}>
            <AppText variant="rowTitle">{r.name}</AppText>
            <AppText variant="meta">
              {recipeMeta(r)} · {missingText(r)}
            </AppText>
          </View>
          <AppText style={styles.pct}>{r.match_pct}%</AppText>
          <ChevronRightIcon size={16} color={colors.textMuted} />
        </Pressable>
      ))}
    </Card>
  );
}

function LinkRow({
  label,
  hint,
  href,
  border,
}: {
  label: string;
  hint: string;
  href: Href;
  border?: boolean;
}) {
  return (
    <Pressable
      onPress={() => router.push(href)}
      accessibilityRole="link"
      accessibilityLabel={`${label}. ${hint}`}
      style={({ pressed }) => [styles.row, border && styles.border, pressed && styles.pressed]}
    >
      <View style={styles.flex}>
        <AppText variant="rowTitle">{label}</AppText>
        <AppText variant="meta">{hint}</AppText>
      </View>
      <ChevronRightIcon size={16} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.screen, gap: spacing.lg, paddingBottom: spacing.xxl },
  flex: { flex: 1 },
  insight: { gap: spacing.sm },
  insightTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  note: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    minHeight: 56,
  },
  border: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { opacity: 0.7 },
  pct: { ...font(700), fontSize: 14, color: colors.primaryChipText, borderRadius: radius.pill },
});
