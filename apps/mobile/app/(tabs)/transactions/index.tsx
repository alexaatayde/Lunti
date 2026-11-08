/** Transactions tab (Transactions.html, SRS 3.1.1): search, month + category filters, history. */
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useCategories,
  useTransactions,
  useTransactionSummary,
  type Transaction,
} from '../../../src/api/hooks';
import {
  AppHeader,
  AppText,
  Badge,
  BottomSheet,
  Button,
  CalendarIcon,
  ChevronDownIcon,
  FilterChip,
  IconButton,
  PageTitle,
  PlusIcon,
  SearchIcon,
  TextField,
  TintCard,
} from '../../../src/components';
import { AddTransactionSheet } from '../../../src/features/money/AddTransactionSheet';
import { CategoryIcon } from '../../../src/features/money/CategoryIcon';
import { EmptyState, ErrorState, LoadingBlocks } from '../../../src/features/money/StateViews';
import { groupByDay, rowMeta } from '../../../src/features/money/transactionList';
import {
  currentMonth,
  formatMonth,
  formatTime,
  monthRange,
  shiftMonth,
  type MonthKey,
} from '../../../src/lib/dates';
import { formatMoney } from '../../../src/lib/money';
import { colors, font, radius, spacing } from '../../../src/theme';

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export default function TransactionsScreen() {
  const insets = useSafeAreaInsets();
  const [month, setMonth] = useState<MonthKey>(() => currentMonth());
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [monthOpen, setMonthOpen] = useState(false);
  const q = useDebounced(search.trim());

  const filters = useMemo(
    () => ({ ...monthRange(month), category_id: categoryId, q: q || undefined }),
    [month, categoryId, q],
  );
  const categories = useCategories();
  const list = useTransactions(filters);
  const summary = useTransactionSummary(filters);

  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const sections = useMemo(() => groupByDay(items), [items]);
  const filtered = !!categoryId || !!q;
  const monthName = formatMonth(month);

  const openManual = () => {
    setAddOpen(false);
    router.push({ pathname: '/expense-form', params: { mode: 'add' } });
  };

  const header = (
    <View style={styles.headerBlock}>
      <PageTitle
        eyebrow="Every purchase, in one place"
        title="Transactions"
        action={
          <IconButton
            icon={<PlusIcon size={22} color={colors.textOnPrimary} />}
            accessibilityLabel="Add transaction"
            onPress={() => setAddOpen(true)}
          />
        }
      />
      <TextField
        label="Search store or item"
        hideLabel
        placeholder="Search store or item"
        value={search}
        onChangeText={setSearch}
        leftIcon={<SearchIcon size={18} color={colors.textFaint} />}
        returnKeyType="search"
        autoCorrect={false}
        height={48}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.chips}
        style={styles.chipScroll}
      >
        <FilterChip
          label={monthName}
          accessibilityLabel={`Month: ${monthName}. Change`}
          onPress={() => setMonthOpen(true)}
          leading={<CalendarIcon size={16} color={colors.text} />}
          trailing={<ChevronDownIcon size={14} color={colors.text} />}
        />
        <FilterChip label="All" active={!categoryId} onPress={() => setCategoryId(undefined)} />
        {(categories.data ?? []).map((c) => (
          <FilterChip
            key={c.id}
            label={c.name}
            active={categoryId === c.id}
            onPress={() => setCategoryId(categoryId === c.id ? undefined : c.id)}
          />
        ))}
      </ScrollView>

      {summary.data ? (
        <TintCard style={styles.summary}>
          <View style={styles.summaryText}>
            <AppText style={styles.summaryEyebrow}>Spent in {monthName}</AppText>
            <View style={styles.summaryRow}>
              <AppText style={styles.summaryTotal} adjustsFontSizeToFit numberOfLines={1}>
                {formatMoney(summary.data.total)}
              </AppText>
            </View>
            <AppText variant="meta">
              {summary.data.count} {summary.data.count === 1 ? 'transaction' : 'transactions'}
            </AppText>
          </View>
          <View style={styles.badges}>
            <Badge label={`${summary.data.receipt_count} scanned`} tone="outline" />
            <Badge label={`${summary.data.manual_count} manual`} tone="neutral" />
          </View>
        </TintCard>
      ) : null}
    </View>
  );

  let body: React.ReactNode = null;
  if (list.isPending) {
    body = <LoadingBlocks label="Loading transactions" heights={[96, 132, 132]} />;
  } else if (list.isError) {
    body = (
      <ErrorState
        message={list.error.message}
        onRetry={() => {
          list.refetch();
          summary.refetch();
        }}
        retrying={list.isFetching}
      />
    );
  } else if (items.length === 0) {
    body = filtered ? (
      <EmptyState
        title="Nothing matches"
        message="Try another search or category, or a different month."
        action={
          <Button
            label="Clear filters"
            variant="secondary"
            onPress={() => {
              setSearch('');
              setCategoryId(undefined);
            }}
          />
        }
      />
    ) : (
      <EmptyState
        title={`No transactions in ${monthName}`}
        message="Add an expense and it shows up here, and in your budgets."
        action={<Button label="Add expense" onPress={openManual} />}
      />
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <AppHeader onAvatarPress={() => router.push('/profile')} />
      <SectionList
        sections={body ? [] : sections}
        keyExtractor={(t) => t.id}
        stickySectionHeadersEnabled={false}
        // One tap on a chip or button works while the search keyboard is open.
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            {header}
            {body}
          </>
        }
        renderSectionHeader={({ section }) => (
          <AppText style={styles.dayHeader} accessibilityRole="header">
            {section.title}
          </AppText>
        )}
        renderItem={({ item, index, section }) => (
          <TransactionRow
            item={item}
            first={index === 0}
            last={index === section.data.length - 1}
          />
        )}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
        }}
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <LoadingBlocks label="Loading more" heights={[64]} />
          ) : list.isFetchNextPageError ? (
            <Button label="Load more" variant="secondary" onPress={() => list.fetchNextPage()} />
          ) : undefined
        }
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isFetchingNextPage}
            onRefresh={() => {
              list.refetch();
              summary.refetch();
            }}
            colors={[colors.primary]}
          />
        }
      />

      <AddTransactionSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onScan={() => {
          setAddOpen(false);
          router.push('/scan/camera');
        }}
        onManual={openManual}
      />
      <MonthSheet
        visible={monthOpen}
        value={month}
        onClose={() => setMonthOpen(false)}
        onSelect={(m) => {
          setMonth(m);
          setMonthOpen(false);
        }}
      />
    </View>
  );
}

function TransactionRow({
  item,
  first,
  last,
}: {
  item: Transaction;
  first: boolean;
  last: boolean;
}) {
  const title = item.merchant ?? item.category.name;
  const amount = formatMoney(item.amount);
  const time = formatTime(new Date(item.occurred_at));
  const meta = rowMeta(item);
  return (
    <Pressable
      onPress={() => router.push(`/transactions/${item.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${amount}, ${meta}, ${time}`}
      style={({ pressed }) => [
        styles.row,
        first && styles.rowFirst,
        last && styles.rowLast,
        !first && styles.rowDivider,
        pressed && styles.rowPressed,
      ]}
    >
      <CategoryIcon icon={item.category.icon} />
      <View style={styles.rowMiddle}>
        <AppText variant="rowTitle" numberOfLines={1}>
          {title}
        </AppText>
        <AppText variant="meta" numberOfLines={1}>
          {meta}
        </AppText>
      </View>
      <View style={styles.rowRight}>
        <AppText variant="rowTitle">{amount}</AppText>
        <AppText variant="small" color={colors.textFaint}>
          {time}
        </AppText>
      </View>
    </Pressable>
  );
}

function MonthSheet({
  visible,
  value,
  onClose,
  onSelect,
}: {
  visible: boolean;
  value: MonthKey;
  onClose: () => void;
  onSelect: (m: MonthKey) => void;
}) {
  const months = useMemo(() => {
    const now = currentMonth();
    return Array.from({ length: 12 }, (_, i) => shiftMonth(now, -i));
  }, []);
  return (
    <BottomSheet visible={visible} onClose={onClose} eyebrow="Filter" title="Choose a month">
      <ScrollView style={styles.monthList}>
        {months.map((m) => {
          const selected = m.year === value.year && m.month === value.month;
          return (
            <Pressable
              key={`${m.year}-${m.month}`}
              onPress={() => onSelect(m)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              style={({ pressed }) => [
                styles.monthRow,
                selected && styles.monthSelected,
                pressed && styles.rowPressed,
              ]}
            >
              <AppText style={[styles.monthText, selected && styles.monthTextSelected]}>
                {formatMonth(m)}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screen, paddingBottom: spacing.xxl },
  headerBlock: { gap: spacing.lg, paddingTop: spacing.sm, marginBottom: spacing.lg },
  chipScroll: { marginHorizontal: -spacing.screen },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.screen },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summaryText: { flex: 1, minWidth: 0 },
  summaryEyebrow: {
    ...font(700),
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.55,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'baseline' },
  summaryTotal: {
    ...font(900),
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.75,
    color: colors.text,
  },
  badges: { gap: spacing.sm, alignItems: 'flex-end' },
  dayHeader: {
    ...font(700),
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  rowFirst: {
    borderTopWidth: 1,
    borderTopLeftRadius: radius.listCard,
    borderTopRightRadius: radius.listCard,
  },
  rowLast: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: radius.listCard,
    borderBottomRightRadius: radius.listCard,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowPressed: { backgroundColor: colors.surfaceSubtle },
  rowMiddle: { flex: 1, minWidth: 0 },
  rowRight: { alignItems: 'flex-end' },
  monthList: { maxHeight: 420 },
  monthRow: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.input,
  },
  monthSelected: { backgroundColor: colors.surfaceTint },
  monthText: { ...font(500), fontSize: 15, color: colors.text },
  monthTextSelected: { ...font(700), color: colors.primaryChipText },
});
