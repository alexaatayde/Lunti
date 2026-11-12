/**
 * Analytics tab (Analytics.html, SRS 3.1.4–3.1.5). Analytics.html is from the earlier visual
 * generation, so its layout is kept but drawn with the current tokens (DESIGN_HANDOFF.md §6).
 * Every figure comes from GET /analytics/summary and /analytics/patterns.
 *
 * Not built: the design's "Recurring expenses" card. No approved rule detects recurring bills
 * yet (AGENTS.md §7.3 covers products only), so it is left out instead of guessed.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useAnalyticsSummary,
  usePurchasePatterns,
  type AnalyticsPeriod,
  type AnalyticsSummary,
  type ProductPattern,
} from '../../src/api/hooks';
import {
  AppText,
  ArrowDownIcon,
  ArrowUpIcon,
  Badge,
  Card,
  ChevronRightIcon,
  SegmentedControl,
} from '../../src/components';
import {
  categorySlices,
  changeText,
  comparisonNote,
  comparisonTitle,
  PERIOD_OPTIONS,
  patternBadge,
  patternLine,
  trendBars,
  trendTitle,
  visiblePatterns,
  windowLabels,
  type Bar,
  type Slice,
} from '../../src/features/analytics/display';
import { DonutChart, SLICE_COLORS } from '../../src/features/analytics/DonutChart';
import { EmptyState, ErrorState, LoadingBlocks } from '../../src/features/money/StateViews';
import { formatMoney } from '../../src/lib/money';
import { colors, font, radius, spacing } from '../../src/theme';

export default function AnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<AnalyticsPeriod>('monthly');
  const summary = useAnalyticsSummary(period);
  const patterns = usePurchasePatterns();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={summary.isRefetching || patterns.isRefetching}
            onRefresh={() => {
              void summary.refetch();
              void patterns.refetch();
            }}
            colors={[colors.primary]}
          />
        }
      >
        <AppText variant="pageTitle" accessibilityRole="header" style={styles.title}>
          Analytics
        </AppText>
        <SegmentedControl
          accessibilityLabel="Analytics period"
          value={period}
          onChange={setPeriod}
          options={PERIOD_OPTIONS}
        />

        {summary.isPending ? (
          <LoadingBlocks label="Loading spending summary" heights={[130, 300, 190]} />
        ) : summary.isError ? (
          <ErrorState
            message={summary.error.message}
            onRetry={() => summary.refetch()}
            retrying={summary.isFetching}
          />
        ) : (
          <>
            <ComparisonCard summary={summary.data} />
            <CategoryCard summary={summary.data} />
            <TrendCard summary={summary.data} />
          </>
        )}

        {patterns.isPending ? (
          <LoadingBlocks label="Loading purchase patterns" heights={[180]} />
        ) : patterns.isError ? (
          <ErrorState
            message={patterns.error.message}
            onRetry={() => patterns.refetch()}
            retrying={patterns.isFetching}
          />
        ) : (
          <PatternsCard patterns={patterns.data} />
        )}
      </ScrollView>
    </View>
  );
}

// ---------- compared with last period ----------

function ComparisonCard({ summary }: { summary: AnalyticsSummary }) {
  const labels = windowLabels(summary);
  const change = changeText(summary);
  const Arrow = change.direction === 'down' ? ArrowDownIcon : ArrowUpIcon;
  return (
    <Card style={styles.card}>
      <AppText variant="cardTitle" accessibilityRole="header">
        {comparisonTitle(summary.period)}
      </AppText>
      <View style={styles.compareRow}>
        <View
          style={styles.flex}
          accessible
          accessibilityLabel={`${labels.current}: ${formatMoney(summary.total)}`}
        >
          <AppText variant="meta">{labels.current}</AppText>
          <AppText variant="moneyL" numberOfLines={1} adjustsFontSizeToFit>
            {formatMoney(summary.total)}
          </AppText>
        </View>
        <View style={styles.divider} />
        <View
          style={styles.flex}
          accessible
          accessibilityLabel={`${labels.previous}: ${formatMoney(summary.previous_total)}`}
        >
          <AppText variant="meta">{labels.previous}</AppText>
          <AppText variant="moneyL" color={colors.textMuted} numberOfLines={1} adjustsFontSizeToFit>
            {formatMoney(summary.previous_total)}
          </AppText>
        </View>
      </View>
      <View
        style={[styles.changeChip, change.direction === 'up' && styles.changeChipUp]}
        accessible
        accessibilityLabel={change.text}
      >
        {change.direction === 'down' || change.direction === 'up' ? (
          <Arrow
            size={14}
            color={change.direction === 'down' ? colors.primaryChipText : colors.warnStrong}
          />
        ) : null}
        <AppText style={[styles.changeText, change.direction === 'up' && styles.changeTextUp]}>
          {change.text}
        </AppText>
      </View>
      <AppText variant="meta">{comparisonNote(summary)}</AppText>
    </Card>
  );
}

// ---------- category breakdown ----------

function openCategory(slice: Slice, summary: AnalyticsSummary) {
  if (!slice.categoryId) return;
  router.push({
    pathname: '/transactions',
    params: { category: slice.categoryId, month: summary.start.slice(0, 7) },
  });
}

function CategoryCard({ summary }: { summary: AnalyticsSummary }) {
  const slices = categorySlices(summary.by_category, summary.total);
  return (
    <Card style={styles.card}>
      <View style={styles.headerBlock}>
        <AppText variant="cardTitle" accessibilityRole="header">
          Category breakdown
        </AppText>
        {slices.length > 0 ? (
          <AppText variant="meta">Tap a category to see its transactions</AppText>
        ) : null}
      </View>
      {slices.length === 0 ? (
        <AppText variant="body">
          No spending in this period yet. Add or scan a purchase to see where your money goes.
        </AppText>
      ) : (
        <>
          <DonutChart slices={slices} total={summary.total} />
          <View>
            {slices.map((slice, i) => (
              <Pressable
                key={slice.key}
                disabled={!slice.categoryId}
                onPress={() => openCategory(slice, summary)}
                accessibilityRole={slice.categoryId ? 'button' : undefined}
                accessibilityLabel={`${slice.name}, ${slice.pct}%, ${formatMoney(slice.total)}`}
                accessibilityHint={slice.categoryId ? 'Shows its transactions' : undefined}
                style={({ pressed }) => [
                  styles.legendRow,
                  i < slices.length - 1 && styles.rowBorder,
                  pressed && styles.pressed,
                ]}
              >
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length] },
                  ]}
                />
                <AppText variant="body" color={colors.text} style={styles.flex} numberOfLines={1}>
                  {slice.name}
                </AppText>
                <AppText variant="body">{slice.pct}%</AppText>
                <AppText style={styles.amount}>{formatMoney(slice.total)}</AppText>
                {slice.categoryId ? (
                  <ChevronRightIcon size={16} color={colors.textMuted} />
                ) : (
                  <View style={styles.chevronSpace} />
                )}
              </Pressable>
            ))}
          </View>
        </>
      )}
    </Card>
  );
}

// ---------- spending trend ----------

const BAR_AREA = 110;

function TrendCard({ summary }: { summary: AnalyticsSummary }) {
  const bars = trendBars(summary);
  const showValues = summary.trend_granularity === 'week';
  return (
    <Card style={styles.card}>
      <View style={styles.trendHeader}>
        <AppText variant="cardTitle" accessibilityRole="header">
          Spending trend
        </AppText>
        <AppText variant="meta">{trendTitle(summary)}</AppText>
      </View>
      <View style={styles.bars}>
        {bars.map((bar) => (
          <TrendBar key={bar.key} bar={bar} showValue={showValues} />
        ))}
      </View>
    </Card>
  );
}

function TrendBar({ bar, showValue }: { bar: Bar; showValue: boolean }) {
  const empty = bar.future || bar.height === 0;
  return (
    <View style={styles.barColumn} accessible accessibilityLabel={bar.description}>
      <View style={styles.barArea}>
        {showValue ? (
          <AppText style={styles.barValue} numberOfLines={1} adjustsFontSizeToFit>
            {bar.future ? '—' : formatMoney(bar.total)}
          </AppText>
        ) : null}
        <View
          style={[
            styles.bar,
            empty
              ? styles.barEmpty
              : {
                  height: Math.max(6, bar.height * (BAR_AREA - 24)),
                  backgroundColor: bar.peak ? colors.chartBarPeak : colors.chartBar,
                },
          ]}
        />
      </View>
      <AppText variant="meta">{bar.label}</AppText>
    </View>
  );
}

// ---------- product purchase patterns ----------

function PatternsCard({ patterns }: { patterns: ProductPattern[] }) {
  const shown = visiblePatterns(patterns);
  if (shown.length === 0) {
    return (
      <EmptyState
        title="No purchase patterns yet"
        message="Scan your grocery receipts. After you buy the same item a few times, Lunti shows how often you buy it."
      />
    );
  }
  return (
    <Card style={styles.card}>
      <AppText variant="cardTitle" accessibilityRole="header">
        Product purchase patterns
      </AppText>
      <View>
        {shown.map((p, i) => {
          const badge = patternBadge(p);
          const line = patternLine(p);
          return (
            <View
              key={p.product.id}
              style={[styles.patternRow, i < shown.length - 1 && styles.rowBorder]}
              accessible
              accessibilityLabel={`${p.product.name}. ${line}. ${badge.label}`}
            >
              <View style={styles.flex}>
                <AppText variant="rowTitle">{p.product.name}</AppText>
                <AppText variant="meta">{line}</AppText>
              </View>
              {badge.tone === 'dashed' ? (
                <View style={styles.dashedBadge}>
                  <AppText style={styles.dashedText}>{badge.label}</AppText>
                </View>
              ) : (
                <Badge label={badge.label} tone={badge.tone} />
              )}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: spacing.screen,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: { marginTop: spacing.sm },
  flex: { flex: 1 },
  card: { gap: spacing.md },
  headerBlock: { gap: spacing.xxs },
  compareRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.lg },
  divider: { width: 1, backgroundColor: colors.borderInput },
  changeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.iconTile,
    backgroundColor: colors.primaryChipBg,
  },
  changeChipUp: { backgroundColor: colors.warnBg },
  changeText: {
    ...font(700),
    fontSize: 13,
    color: colors.primaryChipText,
    flexShrink: 1,
  },
  changeTextUp: { color: colors.warnStrong },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  pressed: { opacity: 0.7 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  amount: { ...font(700), fontSize: 14, color: colors.text },
  chevronSpace: { width: 16 },
  trendHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  bars: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' },
  barColumn: { flex: 1, alignItems: 'center', gap: spacing.xs },
  barArea: {
    height: BAR_AREA,
    width: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.xs,
  },
  barValue: { ...font(700), fontSize: 11, color: colors.text },
  bar: {
    width: '100%',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  barEmpty: { height: 6, borderRadius: 3, backgroundColor: colors.track },
  patternRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  dashedBadge: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.dashedBorder,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  dashedText: { ...font(700), fontSize: 12, color: colors.textBody },
});
