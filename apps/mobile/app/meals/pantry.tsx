/**
 * Pantry (Pantry.html, SRS 3.1.8). Amounts are estimates from grocery receipts until the user
 * adjusts or confirms them. Expiry is only what the user sets.
 *
 * Left out (no data in the model, flagged for review): storage place (Fridge/Counter),
 * category chips and item icons by type.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePantry, useUpdatePantryItem, type PantryItem } from '../../src/api/hooks';
import {
  AppText,
  Badge,
  BottomSheet,
  Button,
  Card,
  ChevronLeftIcon,
  ClockBadge,
  PlusIcon,
  TextField,
  TintCard,
} from '../../src/components';
import { amountText, daysLeftText, pantryMeta } from '../../src/features/meals/display';
import { pickDate } from '../../src/features/money/pickDate';
import { EmptyState, ErrorState, LoadingBlocks } from '../../src/features/money/StateViews';
import { normalizeQuantity } from '../../src/lib/centavos';
import { formatShortDate, fromDateKey, localDateKey, todayKey } from '../../src/lib/dates';
import { showToast } from '../../src/stores/toast';
import { colors, font, spacing } from '../../src/theme';

/** −/+ step: one unit, never below 0; works on the decimal string without floats. */
export function stepQuantity(quantity: string, by: 1 | -1): string {
  const [whole, fraction = ''] = normalizeQuantity(quantity).split('.');
  const next = Math.max(0, Number(whole) + by);
  return fraction && next > 0 ? `${next}.${fraction}` : String(next);
}

export default function PantryScreen() {
  const insets = useSafeAreaInsets();
  const pantry = usePantry();
  const update = useUpdatePantryItem();
  const [editing, setEditing] = useState<PantryItem | null>(null);

  const save = async (item: PantryItem, body: Parameters<typeof update.mutateAsync>[0]['body']) => {
    try {
      await update.mutateAsync({ id: item.id, body });
      return true;
    } catch (error) {
      showToast(`Couldn't update ${item.name}. ${(error as Error).message}`);
      return false;
    }
  };

  const data = pantry.data;
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
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]}
        refreshControl={
          <RefreshControl
            refreshing={pantry.isRefetching}
            onRefresh={() => void pantry.refetch()}
            colors={[colors.primary]}
          />
        }
      >
        <View>
          <AppText variant="eyebrow">Your kitchen, at a glance</AppText>
          <AppText variant="pageTitle" accessibilityRole="header">
            Pantry
          </AppText>
        </View>

        {pantry.isPending ? (
          <LoadingBlocks label="Loading your pantry" heights={[130, 160, 220]} />
        ) : pantry.isError ? (
          <ErrorState
            message={pantry.error.message}
            onRetry={() => pantry.refetch()}
            retrying={pantry.isFetching}
          />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="Your pantry is empty"
            message="Scan a grocery receipt and save it. Lunti estimates what you have from it; you can adjust any amount."
            action={<Button label="Scan a receipt" onPress={() => router.push('/scan/camera')} />}
          />
        ) : (
          <>
            <TintCard style={styles.summary}>
              <View style={styles.counts}>
                <Count value={data.in_stock_count} label="In stock" />
                <Count value={data.use_soon_count} label="Use soon" tone={colors.warnText} />
                <Count value={data.depleted_count} label="Used up" tone={colors.dangerText} />
              </View>
              {data.estimated_count > 0 ? (
                <AppText variant="meta">
                  {data.estimated_count} {data.estimated_count === 1 ? 'amount is' : 'amounts are'}{' '}
                  estimated from receipts. Adjust any to confirm it.
                </AppText>
              ) : null}
            </TintCard>

            {data.use_first.length > 0 ? (
              <>
                <View>
                  <AppText variant="sectionTitle" accessibilityRole="header">
                    Use first
                  </AppText>
                  <AppText variant="meta">Near the best-before date you set</AppText>
                </View>
                <Card size="list" padding={0}>
                  {data.use_first.map((item, i) => (
                    <View key={item.id} style={[styles.row, i > 0 && styles.border]}>
                      <View style={styles.flex}>
                        <AppText variant="rowTitle">{item.name}</AppText>
                        <AppText variant="meta">{amountText(item.quantity, item.unit)}</AppText>
                        <Pressable
                          onPress={() => router.push('/meals')}
                          accessibilityRole="link"
                          accessibilityLabel={`Find a recipe for ${item.name}`}
                          style={styles.link}
                        >
                          <AppText style={styles.linkText}>Find a recipe</AppText>
                        </Pressable>
                      </View>
                      <ClockBadge label={daysLeftText(item.days_left) ?? ''} />
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            <View>
              <AppText variant="sectionTitle" accessibilityRole="header">
                In your pantry
              </AppText>
              <AppText variant="meta">
                {data.items.length} {data.items.length === 1 ? 'item' : 'items'} · tap one to edit
              </AppText>
            </View>
            <Card size="list" padding={0}>
              {data.items.map((item, i) => (
                <View key={item.id} style={[styles.row, i > 0 && styles.border]}>
                  <Pressable
                    onPress={() => setEditing(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${item.name}, ${pantryMeta(item)}, ${item.confirmed ? 'confirmed' : 'estimated'}`}
                    style={styles.flex}
                  >
                    <AppText variant="rowTitle">{item.name}</AppText>
                    <View style={styles.tags}>
                      <Badge
                        label={item.confirmed ? 'Confirmed' : 'Estimated'}
                        tone={item.confirmed ? 'success' : 'neutral'}
                      />
                      <AppText variant="meta">{pantryMeta(item)}</AppText>
                    </View>
                  </Pressable>
                  <View style={styles.stepper}>
                    <StepButton
                      label={`Less ${item.name}`}
                      symbol="−"
                      disabled={item.quantity === '0.000' || update.isPending}
                      onPress={() => void save(item, { quantity: stepQuantity(item.quantity, -1) })}
                    />
                    <AppText style={styles.qty}>{normalizeQuantity(item.quantity)}</AppText>
                    <StepButton
                      label={`More ${item.name}`}
                      symbol="+"
                      disabled={update.isPending}
                      onPress={() => void save(item, { quantity: stepQuantity(item.quantity, 1) })}
                    />
                  </View>
                </View>
              ))}
            </Card>
          </>
        )}
      </ScrollView>

      {editing ? (
        <EditSheet
          item={editing}
          saving={update.isPending}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            if (await save(editing, body)) {
              showToast(`${editing.name} updated.`);
              setEditing(null);
            }
          }}
        />
      ) : null}
    </View>
  );
}

function Count({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <View style={styles.count} accessible accessibilityLabel={`${value} ${label}`}>
      <AppText style={[styles.countValue, tone ? { color: tone } : null]}>{value}</AppText>
      <AppText variant="meta">{label}</AppText>
    </View>
  );
}

function StepButton({
  label,
  symbol,
  disabled,
  onPress,
}: {
  label: string;
  symbol: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.step, (pressed || disabled) && styles.pressed]}
    >
      {symbol === '+' ? (
        <PlusIcon size={18} color={colors.textStrong} />
      ) : (
        <AppText style={styles.minus}>−</AppText>
      )}
    </Pressable>
  );
}

function EditSheet({
  item,
  saving,
  onClose,
  onSave,
}: {
  item: PantryItem;
  saving: boolean;
  onClose: () => void;
  onSave: (body: {
    quantity?: string;
    unit?: string | null;
    estimated_expiry?: string | null;
    confirmed?: boolean;
  }) => void;
}) {
  const [quantity, setQuantity] = useState(normalizeQuantity(item.quantity));
  const [unit, setUnit] = useState(item.unit ?? '');
  const [expiry, setExpiry] = useState<string | null>(item.estimated_expiry ?? null);
  const valid = /^\d+(\.\d{1,3})?$/.test(quantity.trim());

  return (
    <BottomSheet
      visible
      onClose={onClose}
      eyebrow={item.confirmed ? 'Confirmed' : 'Estimated'}
      title={item.name}
    >
      <View style={styles.sheet}>
        <View style={styles.sheetRow}>
          <View style={styles.flex}>
            <TextField
              label="Amount"
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="decimal-pad"
              error={valid ? undefined : 'Enter 0 or more (up to 3 decimals).'}
            />
          </View>
          <View style={styles.flex}>
            <TextField label="Unit" value={unit} onChangeText={setUnit} placeholder="kg, pcs…" />
          </View>
        </View>
        <Pressable
          onPress={async () => {
            const picked = await pickDate({
              value: expiry ? fromDateKey(expiry) : fromDateKey(todayKey()),
            });
            if (picked) setExpiry(localDateKey(picked));
          }}
          accessibilityRole="button"
          accessibilityLabel={
            expiry
              ? `Best before ${formatShortDate(fromDateKey(expiry))}. Change date`
              : 'Set a best-before date'
          }
          style={styles.dateRow}
        >
          <AppText variant="label">Best before</AppText>
          <AppText variant="body" color={colors.text}>
            {expiry ? formatShortDate(fromDateKey(expiry)) : 'Not set'}
          </AppText>
        </Pressable>
        {expiry ? (
          <Button label="Clear date" variant="ghost" onPress={() => setExpiry(null)} />
        ) : null}
        <Button
          label="Save"
          loading={saving}
          disabled={!valid}
          onPress={() =>
            onSave({
              quantity: normalizeQuantity(quantity.trim()),
              unit: unit.trim() || null,
              estimated_expiry: expiry,
            })
          }
        />
      </View>
    </BottomSheet>
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
  summary: { gap: spacing.md },
  counts: { flexDirection: 'row', justifyContent: 'space-around' },
  count: { alignItems: 'center', gap: spacing.xxs },
  countValue: { ...font(800), fontSize: 24, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  border: { borderTopWidth: 1, borderTopColor: colors.border },
  tags: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
    marginTop: spacing.xs,
  },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { ...font(700), fontSize: 15, color: colors.primaryLink },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  step: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.borderInput,
    alignItems: 'center',
    justifyContent: 'center',
  },
  minus: { ...font(600), fontSize: 20, color: colors.textStrong },
  qty: { ...font(700), fontSize: 16, color: colors.text, minWidth: 28, textAlign: 'center' },
  pressed: { opacity: 0.5 },
  sheet: { gap: spacing.md },
  sheetRow: { flexDirection: 'row', gap: spacing.md },
  dateRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderInput,
  },
});
