/**
 * Grocery list (ShoppingList.html, SRS 3.1.6–3.1.7). Totals and the budget check come from
 * GET /shopping-lists; restock suggestions from GET /replenishment/suggestions.
 *
 * Simplified from the design (flagged for review): no aisle grouping (items have no aisle
 * data), no "At the store?" toggle and no Checkout. Items are "To buy" and "Picked up".
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useAddListItem,
  useDeleteListItem,
  useShoppingList,
  useSuggestions,
  useUpdateListItem,
  type ShoppingList,
  type ShoppingListItem,
} from '../../src/api/hooks';
import {
  AppText,
  Badge,
  Card,
  CheckIcon,
  ChevronLeftIcon,
  PlusIcon,
  ProgressBar,
  TintCard,
} from '../../src/components';
import { ItemSheet } from '../../src/features/lists/ItemSheet';
import {
  quantityText,
  sourceLabel,
  suggestionLine,
  unitPriceText,
} from '../../src/features/lists/display';
import { SuggestionActions } from '../../src/features/lists/SuggestionActions';
import { EmptyState, ErrorState, LoadingBlocks } from '../../src/features/money/StateViews';
import { absMoney, formatMoney, isNegativeMoney } from '../../src/lib/money';
import { showToast } from '../../src/stores/toast';
import { colors, font, spacing } from '../../src/theme';

type Editing = { item: ShoppingListItem | null } | null;

export default function GroceryListScreen() {
  const insets = useSafeAreaInsets();
  const list = useShoppingList();
  const suggestions = useSuggestions();
  const listId = list.data?.id;
  const add = useAddListItem(listId);
  const update = useUpdateListItem(listId);
  const remove = useDeleteListItem(listId);
  const [editing, setEditing] = useState<Editing>(null);

  const toggle = async (item: ShoppingListItem) => {
    try {
      await update.mutateAsync({ id: item.id, body: { is_purchased: !item.is_purchased } });
    } catch (error) {
      showToast(`Couldn't update ${item.name}. ${(error as Error).message}`);
    }
  };

  const save = async (body: Parameters<typeof add.mutateAsync>[0]) => {
    if (editing?.item) {
      await update.mutateAsync({ id: editing.item.id, body });
      showToast('Item updated.');
    } else {
      await add.mutateAsync(body);
      showToast(`${body.name} added to your list.`);
    }
    setEditing(null);
  };

  const onDelete = async () => {
    const item = editing?.item;
    if (!item) return;
    try {
      await remove.mutateAsync(item.id);
      showToast(`${item.name} removed.`);
      setEditing(null);
    } catch (error) {
      showToast(`Couldn't remove it. ${(error as Error).message}`);
    }
  };

  const data = list.data;
  const open = data?.items.filter((i) => !i.is_purchased) ?? [];
  const picked = data?.items.filter((i) => i.is_purchased) ?? [];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/meals'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={styles.back}
        >
          <ChevronLeftIcon size={22} color={colors.text} />
          <AppText variant="body" color={colors.text}>
            Back
          </AppText>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: spacing.xxl + 72 + insets.bottom },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching || suggestions.isRefetching}
            onRefresh={() => {
              void list.refetch();
              void suggestions.refetch();
            }}
            colors={[colors.primary]}
          />
        }
      >
        <View>
          <AppText variant="eyebrow">Your next shop</AppText>
          <AppText variant="pageTitle" accessibilityRole="header">
            Grocery list
          </AppText>
        </View>

        {list.isPending ? (
          <LoadingBlocks label="Loading your grocery list" heights={[170, 120, 200]} />
        ) : list.isError ? (
          <ErrorState
            message={list.error.message}
            onRetry={() => list.refetch()}
            retrying={list.isFetching}
          />
        ) : data ? (
          <>
            <CartCard list={data} />
            <SuggestionsCard query={suggestions} />
            <View style={styles.sectionHeader}>
              <View style={styles.flex}>
                <AppText variant="sectionTitle" accessibilityRole="header">
                  To buy
                </AppText>
                <AppText variant="meta">
                  {open.length} {open.length === 1 ? 'item' : 'items'}
                </AppText>
              </View>
              <Pressable
                onPress={() => setEditing({ item: null })}
                accessibilityRole="button"
                accessibilityLabel="Add item"
                style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
              >
                <PlusIcon size={18} color={colors.primaryLink} />
                <AppText style={styles.addText}>Add item</AppText>
              </Pressable>
            </View>
            {open.length === 0 ? (
              <EmptyState
                title={picked.length ? 'All picked up' : 'Your list is empty'}
                message="Add what you need, or add a restock suggestion. Lunti estimates the total from what you usually pay."
              />
            ) : (
              <ItemGroup items={open} onToggle={toggle} onEdit={(item) => setEditing({ item })} />
            )}
            {picked.length > 0 ? (
              <>
                <AppText variant="sectionTitle" accessibilityRole="header">
                  Picked up
                </AppText>
                <ItemGroup
                  items={picked}
                  onToggle={toggle}
                  onEdit={(item) => setEditing({ item })}
                />
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {data ? (
        <View style={[styles.footer, { paddingBottom: spacing.md + insets.bottom }]}>
          <View
            accessible
            accessibilityLabel={`${data.purchased_count} picked up, ${formatMoney(data.picked_total)}`}
          >
            <AppText variant="meta">{data.purchased_count} picked up</AppText>
            <AppText variant="moneyL">{formatMoney(data.picked_total)}</AppText>
          </View>
        </View>
      ) : null}

      {editing ? (
        <ItemSheet
          item={editing.item}
          saving={add.isPending || update.isPending}
          deleting={remove.isPending}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={editing.item ? onDelete : undefined}
        />
      ) : null}
    </View>
  );
}

function CartCard({ list }: { list: ShoppingList }) {
  const budget = list.budget;
  const over = budget ? isNegativeMoney(budget.remaining_after) : false;
  return (
    <TintCard style={styles.cart}>
      <AppText variant="eyebrow" color={colors.textBody}>
        Estimated cart total
      </AppText>
      <AppText
        variant="moneyXL"
        accessibilityLabel={`Estimated cart total ${formatMoney(list.estimated_total)}`}
      >
        {formatMoney(list.estimated_total)}
      </AppText>
      {budget ? (
        <AppText variant="body">
          of {formatMoney(budget.remaining)} left in your {budget.label} budget
        </AppText>
      ) : (
        <AppText variant="body">Set a Groceries budget to see how this cart fits.</AppText>
      )}
      {list.unpriced_count > 0 ? (
        <AppText variant="meta">
          {list.unpriced_count} {list.unpriced_count === 1 ? 'item has' : 'items have'} no price yet
          and
          {list.unpriced_count === 1 ? " isn't" : " aren't"} counted.
        </AppText>
      ) : null}
      {budget ? (
        <View style={styles.safety}>
          <View style={styles.safetyRow}>
            <View style={styles.flex}>
              <AppText variant="rowTitle">
                {over ? 'Over budget' : `${budget.percent_left_after}% budget left after this cart`}
              </AppText>
              <AppText variant="meta">
                {over
                  ? `This cart is ${formatMoney(absMoney(budget.remaining_after))} over what's left`
                  : `${formatMoney(budget.remaining_after)} left after this cart`}
              </AppText>
            </View>
            {over ? <Badge label="Over" tone="danger" /> : null}
          </View>
          <ProgressBar
            value={budget.percent_left_after / 100}
            accessibilityLabel={`${budget.percent_left_after}% of the budget left after this cart`}
          />
        </View>
      ) : null}
    </TintCard>
  );
}

function SuggestionsCard({ query }: { query: ReturnType<typeof useSuggestions> }) {
  if (query.isPending) return <LoadingBlocks label="Loading restock suggestions" heights={[90]} />;
  if (query.isError) {
    return (
      <ErrorState
        message={`Couldn't load restock suggestions. ${query.error.message}`}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  if (query.data.length === 0) return null;
  return (
    <Card style={styles.cardGap}>
      <View>
        <AppText variant="cardTitle" accessibilityRole="header">
          Running low?
        </AppText>
        <AppText variant="meta">Based on how often you usually buy these</AppText>
      </View>
      {query.data.map((s, i) => (
        <View key={s.id} style={[styles.suggestion, i > 0 && styles.rowBorderTop]}>
          <View accessible accessibilityLabel={`${s.product.name}. ${suggestionLine(s)}`}>
            <AppText variant="rowTitle">{s.product.name}</AppText>
            <AppText variant="meta">{suggestionLine(s)}</AppText>
          </View>
          <SuggestionActions suggestion={s} />
        </View>
      ))}
    </Card>
  );
}

function ItemGroup({
  items,
  onToggle,
  onEdit,
}: {
  items: ShoppingListItem[];
  onToggle: (item: ShoppingListItem) => void;
  onEdit: (item: ShoppingListItem) => void;
}) {
  return (
    <Card size="list" padding={0}>
      {items.map((item, i) => {
        const label = sourceLabel(item);
        const each = unitPriceText(item);
        return (
          <View key={item.id} style={[styles.itemRow, i > 0 && styles.rowBorderTop]}>
            <Pressable
              onPress={() => onToggle(item)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.is_purchased }}
              accessibilityLabel={`${item.name}, ${item.is_purchased ? 'picked up' : 'to buy'}`}
              hitSlop={6}
              style={[styles.check, item.is_purchased && styles.checkOn]}
            >
              {item.is_purchased ? <CheckIcon size={16} color={colors.textOnPrimary} /> : null}
            </Pressable>
            <Pressable
              onPress={() => onEdit(item)}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${item.name}`}
              style={({ pressed }) => [styles.itemBody, pressed && styles.pressed]}
            >
              <View style={styles.flex}>
                <AppText
                  variant="rowTitle"
                  style={item.is_purchased ? styles.done : undefined}
                  numberOfLines={2}
                >
                  {item.name}
                </AppText>
                <AppText variant="meta">{quantityText(item)}</AppText>
                {label ? (
                  <View style={styles.badge}>
                    <Badge label={label} tone="outline" />
                  </View>
                ) : null}
              </View>
              <View style={styles.price}>
                <AppText variant="rowTitle">
                  {item.line_estimate ? formatMoney(item.line_estimate) : '—'}
                </AppText>
                {each ? <AppText variant="meta">{each}</AppText> : null}
              </View>
            </Pressable>
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: { paddingHorizontal: spacing.screen, paddingVertical: spacing.sm },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    alignSelf: 'flex-start',
  },
  content: { padding: spacing.screen, paddingTop: 0, gap: spacing.lg },
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  cart: { gap: spacing.sm },
  safety: {
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderTint,
  },
  safetyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardGap: { gap: spacing.md },
  suggestion: { gap: spacing.sm, paddingTop: spacing.md },
  rowBorderTop: { borderTopWidth: 1, borderTopColor: colors.border },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  addText: { ...font(700), fontSize: 16, color: colors.primaryLink },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  itemBody: { flex: 1, flexDirection: 'row', gap: spacing.md, minHeight: 44 },
  done: { textDecorationLine: 'line-through', color: colors.textMuted },
  badge: { marginTop: spacing.xs, alignSelf: 'flex-start' },
  price: { alignItems: 'flex-end' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
