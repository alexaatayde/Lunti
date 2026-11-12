/**
 * ScanReview (ScanReview.html; SRS 3.1.2, 3.6.3): check and correct what OCR read, then
 * "Save receipt". Nothing is saved before that tap (AGENTS.md §4.1). Low-confidence,
 * missing and ambiguous fields are flagged with an icon and words, never color alone.
 *
 * Differences from the design, by decision: no bottom nav (scan flow is modal, handoff §4);
 * no shelf-life / pantry line (pantry is build step 7); the CTA is "Save receipt";
 * "Capture preview / Reset preview" became "Retake photo / Reset changes".
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Controller, useFieldArray, useForm, useWatch, type FieldPath } from 'react-hook-form';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '../../../src/api/client';
import {
  useCategories,
  useConfirmReceipt,
  type Receipt,
  type ReceiptConfirmed,
  type ReceiptFlag,
} from '../../../src/api/hooks';
import {
  AlertCircleIcon,
  AlertDialog,
  AlertTriangleIcon,
  AppText,
  Badge,
  Button,
  CalendarIcon,
  CameraIcon,
  CheckIcon,
  ChevronRightIcon,
  Chip,
  EditIcon,
  InfoIcon,
  PlusIcon,
  ReceiptDocIcon,
  RefreshIcon,
} from '../../../src/components';
import { alertText } from '../../../src/features/money/budgetDisplay';
import { categoryColor } from '../../../src/features/money/CategoryIcon';
import { CategoryPickerSheet, OVERALL } from '../../../src/features/money/CategoryPickerSheet';
import { pickDateTime } from '../../../src/features/money/pickDate';
import { SAVED_MESSAGE } from '../../../src/features/money/useDeleteWithUndo';
import {
  discardQuietly,
  leaveScan,
  restartScan,
  useHardwareBack,
} from '../../../src/features/scan/flow';
import { ItemSheet } from '../../../src/features/scan/ItemSheet';
import {
  LOW_CONFIDENCE_PCT,
  draftToForm,
  flagFor,
  formToConfirm,
  newItemKey,
  reviewSchema,
  totals,
  type ReviewItem,
  type ReviewValues,
} from '../../../src/features/scan/reviewModel';
import { ScanHeader } from '../../../src/features/scan/ScanHeader';
import { fromCentavos, lineTotal, toMilli } from '../../../src/lib/centavos';
import { formatRelativeDay, formatTime } from '../../../src/lib/dates';
import { formatMoney } from '../../../src/lib/money';
import { useScanStore } from '../../../src/stores/scan';
import { showToast } from '../../../src/stores/toast';
import { colors, font, radius, shadows, spacing } from '../../../src/theme';

const money = (cents: bigint | null) => (cents === null ? '₱—' : formatMoney(fromCentavos(cents)));

function savedMessage(saved: ReceiptConfirmed) {
  const alert = saved.budget_alerts[0];
  return alert ? `${SAVED_MESSAGE} ${alertText(alert)}` : SAVED_MESSAGE;
}

export default function ScanReviewScreen() {
  const receipt = useScanStore((s) => s.receipt);
  const photoUri = useScanStore((s) => s.photo?.uri);
  const categories = useCategories();
  const insets = useSafeAreaInsets();
  const reviewable = receipt?.status === 'draft' && !!receipt.draft;
  // The review form handles back itself (it asks before discarding).
  useHardwareBack(reviewable ? null : leaveScan);

  if (!receipt || !reviewable || !receipt.draft) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <ScanHeader step={3} onCancel={leaveScan} />
        <View style={styles.empty}>
          <AppText variant="cardTitle">There&apos;s no receipt to review</AppText>
          <AppText variant="body" style={styles.center}>
            Scan a receipt to check what we read before saving it.
          </AppText>
          <Button label="Scan a receipt" onPress={restartScan} />
        </View>
      </View>
    );
  }
  return (
    <ReviewForm
      receipt={receipt}
      photoUri={photoUri ?? receipt.image_url ?? undefined}
      fallbackCategoryId={categories.data?.[0]?.id ?? ''}
    />
  );
}

const API_FIELDS: Record<string, FieldPath<ReviewValues>> = {
  total: 'total',
  discount: 'discount',
  category_id: 'categoryId',
  occurred_at: 'occurredAt',
  merchant: 'merchant',
  note: 'note',
};
const ITEM_FIELDS: Record<string, keyof ReviewItem> = {
  name: 'name',
  quantity: 'quantity',
  unit_price: 'unitPrice',
  discount: 'discount',
};

function ReviewForm({
  receipt,
  photoUri,
  fallbackCategoryId,
}: {
  receipt: Receipt;
  photoUri?: string;
  fallbackCategoryId: string;
}) {
  const insets = useSafeAreaInsets();
  const categories = useCategories();
  const confirm = useConfirmReceipt(receipt.id);
  const initial = useMemo(
    () => draftToForm(receipt, fallbackCategoryId),
    // Built once per receipt; "Reset changes" goes back to these values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [receipt.id],
  );
  const {
    control,
    handleSubmit,
    reset,
    setValue,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<ReviewValues>({ resolver: zodResolver(reviewSchema), defaultValues: initial });
  const items = useFieldArray({ control, name: 'items', keyName: 'fieldId' });
  const values = useWatch({ control }) as ReviewValues;
  const sums = totals({
    items: values.items ?? [],
    discount: values.discount ?? '',
    total: values.total ?? '',
  });

  const [editing, setEditing] = useState<{ index: number | null; item: ReviewItem } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useHardwareBack(() => setConfirmDiscard(true));
  const [formError, setFormError] = useState<string | null>(null);

  const flags = receipt.flags;
  const category =
    categories.data?.find((c) => c.id === values.categoryId) ?? receipt.suggested_category;
  // Categories may load after the draft: fall back to the first one (Groceries).
  const fallback = categories.data?.[0]?.id;
  useEffect(() => {
    if (!values.categoryId && fallback) setValue('categoryId', fallback);
  }, [values.categoryId, fallback, setValue]);

  const discard = () => {
    discardQuietly(receipt.id);
    leaveScan();
  };

  const onSubmit = handleSubmit(
    async (form) => {
      setFormError(null);
      try {
        const saved = await confirm.mutateAsync(formToConfirm(form));
        showToast(savedMessage(saved));
        useScanStore.getState().reset();
        router.dismissTo('/transactions');
      } catch (error) {
        placeServerErrors(error);
      }
    },
    () => setFormError('Some details need fixing. Check the highlighted fields.'),
  );

  const placeServerErrors = (error: unknown) => {
    const fieldErrors = error instanceof ApiError ? (error.problem?.errors ?? []) : [];
    let placed = false;
    for (const fe of fieldErrors) {
      const item = /^items\.(\d+)\.(\w+)$/.exec(fe.field);
      if (item && ITEM_FIELDS[item[2]]) {
        setError(`items.${Number(item[1])}.${ITEM_FIELDS[item[2]]}`, { message: fe.message });
        placed = true;
      } else if (API_FIELDS[fe.field]) {
        setError(API_FIELDS[fe.field], { message: fe.message });
        placed = true;
      }
    }
    setFormError(
      placed
        ? 'Some details need fixing. Check the highlighted fields.'
        : error instanceof Error
          ? error.message
          : String(error),
    );
  };

  const occurredAt = values.occurredAt ?? initial.occurredAt;
  const itemCount = values.items?.length ?? 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScanHeader step={3} onCancel={() => setConfirmDiscard(true)} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View>
          <AppText variant="eyebrow">A little less guesswork</AppText>
          <AppText variant="pageTitle" accessibilityRole="header">
            Receipt scan
          </AppText>
          <View style={styles.note}>
            <InfoIcon size={14} color={colors.primary} />
            <AppText variant="meta" style={styles.flex}>
              Preview only — check the details before anything is saved.
            </AppText>
          </View>
        </View>

        {receipt.simulated ? (
          <View style={styles.simulated} accessibilityRole="alert">
            <AlertTriangleIcon size={16} color={colors.warnStrong} />
            <AppText variant="meta" color={colors.warnStrong} style={styles.flex}>
              Simulated OCR (development): these details come from a synthetic test receipt,
              not from reading your photo.
            </AppText>
          </View>
        ) : null}

        <View style={styles.viewfinder}>
          {photoUri ? (
            <Image
              source={{ uri: photoUri }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              accessibilityLabel="Your receipt photo"
            />
          ) : (
            <ReceiptDocIcon size={40} color={colors.textFaint} />
          )}
          <View style={styles.viewfinderPill}>
            <View style={styles.dot} />
            <AppText style={styles.pillText}>Scanned draft</AppText>
          </View>
        </View>

        {receipt.confidence ? (
          <View style={styles.chips}>
            <ConfidenceChip label="Store" value={receipt.confidence.store} />
            <ConfidenceChip label="Items" value={receipt.confidence.items} />
            <ConfidenceChip label="Total" value={receipt.confidence.total} />
          </View>
        ) : null}

        <View style={styles.summary}>
          <View style={styles.summaryTile}>
            <ReceiptDocIcon size={24} color={colors.primary} />
          </View>
          <View style={styles.flex}>
            <AppText variant="cardTitle" numberOfLines={1}>
              {values.merchant?.trim() || 'Store not found'}
            </AppText>
            <AppText variant="meta">
              {formatRelativeDay(occurredAt)} · {formatTime(occurredAt)} · {itemCount}{' '}
              {itemCount === 1 ? 'item' : 'items'}
            </AppText>
          </View>
          <View style={styles.summaryRight}>
            <AppText style={styles.summaryTotal}>{formatMoney(values.total || '')}</AppText>
            <AppText variant="small" color={colors.textFaint}>
              receipt total
            </AppText>
          </View>
        </View>

        <View style={styles.links}>
          <LinkButton
            icon={<CameraIcon size={16} color={colors.primaryLink} />}
            label="Retake photo"
            onPress={restartScan}
          />
          <LinkButton
            icon={<RefreshIcon size={16} color={colors.primaryLink} />}
            label="Reset changes"
            onPress={() => {
              reset(initial);
              clearErrors();
              setFormError(null);
            }}
          />
        </View>

        {receipt.possible_duplicate ? (
          <View style={styles.duplicate} accessibilityRole="alert">
            <AlertTriangleIcon size={16} color={colors.warnStrong} />
            <AppText variant="meta" color={colors.warnStrong} style={styles.flex}>
              You already have {formatMoney(receipt.possible_duplicate.amount)}
              {receipt.possible_duplicate.merchant
                ? ` at ${receipt.possible_duplicate.merchant}`
                : ''}{' '}
              on this day. Make sure this receipt isn&apos;t saved twice.
            </AppText>
          </View>
        ) : null}

        {/* ---------- details ---------- */}
        <AppText variant="sectionTitle" accessibilityRole="header">
          Receipt details
        </AppText>
        <View style={styles.card}>
          <Controller
            control={control}
            name="merchant"
            render={({ field }) => (
              <FieldRow label="Store" flag={flagFor(flags, 'merchant')} error={errors.merchant?.message}>
                <TextInput
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="Store name"
                  placeholderTextColor={colors.textFaint}
                  accessibilityLabel="Store"
                  maxLength={120}
                  style={styles.input}
                />
              </FieldRow>
            )}
          />
          <FieldRow
            label="Date"
            divider
            flag={flagFor(flags, 'occurred_at')}
            error={errors.occurredAt?.message}
            onPress={async () => {
              const picked = await pickDateTime({ value: occurredAt, maximumDate: new Date() });
              if (picked) setValue('occurredAt', picked, { shouldValidate: true });
            }}
            accessibilityLabel={`Date, ${formatRelativeDay(occurredAt)} ${formatTime(occurredAt)}. Change`}
            trailing={<CalendarIcon size={20} color={colors.textFaint} />}
          >
            <AppText style={styles.value}>
              {formatRelativeDay(occurredAt)} · {formatTime(occurredAt)}
            </AppText>
          </FieldRow>
          <FieldRow
            label="Category"
            divider
            error={errors.categoryId?.message}
            onPress={() => setPickerOpen(true)}
            accessibilityLabel={`Category, ${category?.name ?? 'not chosen'}. Change`}
            trailing={<ChevronRightIcon size={18} color={colors.textFaint} />}
          >
            {category ? (
              <Chip label={category.name} dotColor={categoryColor(category.icon)} />
            ) : (
              <AppText style={styles.placeholder}>Choose</AppText>
            )}
          </FieldRow>
          <Controller
            control={control}
            name="total"
            render={({ field }) => (
              <FieldRow
                label="Total (₱)"
                divider
                flag={flagFor(flags, 'total')}
                error={errors.total?.message}
              >
                <TextInput
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.textFaint}
                  accessibilityLabel="Receipt total in pesos"
                  style={[styles.input, styles.money]}
                />
              </FieldRow>
            )}
          />
          <Controller
            control={control}
            name="discount"
            render={({ field }) => (
              <FieldRow label="Discount (₱)" divider error={errors.discount?.message}>
                <TextInput
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  keyboardType="decimal-pad"
                  placeholder="Senior, PWD or promo (optional)"
                  placeholderTextColor={colors.textFaint}
                  accessibilityLabel="Receipt discount in pesos"
                  style={styles.input}
                />
              </FieldRow>
            )}
          />
          {receipt.draft?.vat ? (
            <FieldRow label="VAT" divider>
              <AppText style={styles.value}>
                {formatMoney(receipt.draft.vat)}{' '}
                <AppText variant="meta">included in the prices</AppText>
              </AppText>
            </FieldRow>
          ) : null}
          <Controller
            control={control}
            name="note"
            render={({ field }) => (
              <FieldRow label="Note" divider error={errors.note?.message}>
                <TextInput
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="Optional"
                  placeholderTextColor={colors.textFaint}
                  accessibilityLabel="Note"
                  maxLength={500}
                  style={styles.input}
                />
              </FieldRow>
            )}
          />
        </View>

        {/* ---------- items ---------- */}
        <View style={styles.itemsHead}>
          <AppText variant="sectionTitle" accessibilityRole="header">
            Check your items
          </AppText>
          <Badge label={`${itemCount} ${itemCount === 1 ? 'Item' : 'Items'}`} tone="outline" icon={null} />
        </View>
        <AppText variant="meta">Tap an item to fix its name, quantity or price.</AppText>
        {flagFor(flags, 'items') ? <FlagLine flag={flagFor(flags, 'items')!} /> : null}

        <View style={styles.card}>
          {items.fields.map((field, index) => {
            const item = values.items?.[index] ?? field;
            const itemErrors = errors.items?.[index];
            const total = lineTotal(item.quantity, item.unitPrice, item.discount);
            const draftItem = receipt.draft?.items[index];
            const needsReview =
              !!draftItem?.needs_review &&
              draftItem.name === item.name &&
              draftItem.unit_price === item.unitPrice;
            const errorText =
              itemErrors?.name?.message ??
              itemErrors?.quantity?.message ??
              itemErrors?.unitPrice?.message ??
              itemErrors?.discount?.message;
            const wholeQty = /^\d+$/.test(item.quantity);
            return (
              <View key={field.fieldId} style={[styles.itemRow, index > 0 && styles.divider]}>
                <Pressable
                  style={styles.itemMain}
                  onPress={() => setEditing({ index, item: { ...item } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Item ${index + 1}, ${item.name}, ${money(total)}. Edit`}
                >
                  <View style={styles.itemIndex}>
                    <AppText style={styles.itemIndexText}>
                      {String(index + 1).padStart(2, '0')}
                    </AppText>
                  </View>
                  <View style={styles.flex}>
                    <View style={styles.itemNameRow}>
                      <AppText variant="rowTitle" style={styles.shrink} numberOfLines={2}>
                        {item.name || 'Unnamed item'}
                      </AppText>
                      <EditIcon size={14} color={colors.textFaint} />
                    </View>
                    <AppText variant="small">
                      {item.quantity}
                      {item.unit ? ` ${item.unit}` : ''} × {formatMoney(item.unitPrice || '')}
                      {item.discount && /[1-9]/.test(item.discount)
                        ? ` · less ${formatMoney(item.discount)}`
                        : ''}
                    </AppText>
                    {needsReview ? (
                      <View style={styles.inlineFlag}>
                        <AlertTriangleIcon size={12} color={colors.warnText} />
                        <AppText variant="small" color={colors.warnText}>
                          Check the price
                        </AppText>
                      </View>
                    ) : null}
                    {errorText ? (
                      <View style={styles.inlineFlag}>
                        <AlertCircleIcon size={12} color={colors.dangerText} />
                        <AppText variant="small" color={colors.dangerText}>
                          {errorText}
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
                <View style={styles.itemRight}>
                  <AppText variant="rowTitle">{money(total)}</AppText>
                  {wholeQty ? (
                    <Stepper
                      value={item.quantity}
                      label={item.name}
                      onChange={(next) =>
                        setValue(`items.${index}.quantity`, next, { shouldValidate: true })
                      }
                    />
                  ) : null}
                </View>
              </View>
            );
          })}
          <Pressable
            style={({ pressed }) => [
              styles.addRow,
              items.fields.length > 0 && styles.divider,
              pressed && styles.pressed,
            ]}
            onPress={() =>
              setEditing({
                index: null,
                item: {
                  key: newItemKey(),
                  name: '',
                  quantity: '1',
                  unit: null,
                  unitPrice: '',
                  discount: '',
                },
              })
            }
            accessibilityRole="button"
            accessibilityLabel="Add a missing item"
          >
            <PlusIcon size={18} color={colors.primaryLink} />
            <AppText style={styles.link}>Add a missing item</AppText>
          </Pressable>
        </View>

        {/* ---------- totals ---------- */}
        {itemCount > 0 ? (
          <View style={styles.card}>
            <TotalRow label="Items" value={money(sums.itemsSum)} />
            {sums.discount && sums.discount > 0n ? (
              <TotalRow label="Discount" value={`−${money(sums.discount)}`} />
            ) : null}
            <TotalRow label="Items total" value={money(sums.net)} strong />
            <TotalRow label="Receipt total" value={money(sums.total)} strong />
            {sums.mismatch && sums.net !== null && sums.net > 0n ? (
              <View style={styles.mismatch} accessibilityLiveRegion="polite">
                <View style={styles.inlineFlag}>
                  <AlertTriangleIcon size={14} color={colors.warnStrong} />
                  <AppText variant="meta" color={colors.warnStrong} style={styles.flex}>
                    The items don&apos;t add up to the receipt total.
                  </AppText>
                </View>
                <Button
                  label={`Use ${money(sums.net)} as the total`}
                  variant="secondary"
                  onPress={() =>
                    setValue('total', fromCentavos(sums.net!), { shouldValidate: true })
                  }
                />
              </View>
            ) : !sums.mismatch && sums.total !== null && sums.net !== null ? (
              <View style={[styles.inlineFlag, styles.matchLine]}>
                <CheckIcon size={14} color={colors.primary} strokeWidth={2.4} />
                <AppText variant="meta" color={colors.primaryChipText}>
                  Items match the receipt total.
                </AppText>
              </View>
            ) : null}
          </View>
        ) : null}

        {formError ? (
          <View style={styles.formError} accessibilityLiveRegion="polite">
            <AlertCircleIcon size={16} color={colors.dangerText} />
            <AppText variant="body" color={colors.dangerText} style={styles.flex}>
              {formError}
            </AppText>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: spacing.lg + insets.bottom }]}>
        <Button
          label="Save receipt"
          onPress={onSubmit}
          loading={confirm.isPending}
          leftIcon={<CheckIcon size={18} color={colors.textOnPrimary} strokeWidth={2.4} />}
        />
      </View>

      <ItemSheet
        key={editing?.item.key ?? 'closed'}
        item={editing?.item ?? null}
        isNew={editing?.index === null}
        onClose={() => setEditing(null)}
        onSave={(item) => {
          if (editing?.index === null || editing === null) items.append(item);
          else items.update(editing.index, item);
          setEditing(null);
          clearErrors(['items', 'total']);
        }}
        onRemove={() => {
          if (editing && editing.index !== null) items.remove(editing.index);
          setEditing(null);
          clearErrors(['items', 'total']);
        }}
      />

      <CategoryPickerSheet
        visible={pickerOpen}
        value={values.categoryId ?? null}
        onClose={() => setPickerOpen(false)}
        onSelect={(picked) => {
          if (picked !== OVERALL) setValue('categoryId', picked.id, { shouldValidate: true });
          setPickerOpen(false);
        }}
      />

      <AlertDialog
        visible={confirmDiscard}
        title="Discard this scan?"
        message="The photo and the details we read will be deleted. Nothing has been saved."
        confirmLabel="Discard"
        cancelLabel="Keep reviewing"
        onConfirm={discard}
        onCancel={() => setConfirmDiscard(false)}
      />
    </View>
  );
}

// ---------- pieces ----------

function ConfidenceChip({ label, value }: { label: string; value: number }) {
  const low = value < LOW_CONFIDENCE_PCT;
  return (
    <View
      style={[styles.chip, low && styles.chipLow]}
      accessible
      accessibilityLabel={`${label} confidence ${value} percent${low ? ', check it' : ''}`}
    >
      {low ? <AlertTriangleIcon size={12} color={colors.warnStrong} /> : null}
      <AppText style={styles.chipLabel}>{label}</AppText>
      <AppText style={[styles.chipValue, low && styles.chipValueLow]}>{value}%</AppText>
    </View>
  );
}

function FlagLine({ flag }: { flag: ReceiptFlag }) {
  return (
    <View style={styles.inlineFlag}>
      <AlertTriangleIcon size={12} color={colors.warnText} />
      <AppText variant="small" color={colors.warnText} style={styles.flex}>
        {flag.message}
      </AppText>
    </View>
  );
}

function FieldRow({
  label,
  children,
  divider,
  onPress,
  trailing,
  accessibilityLabel,
  flag,
  error,
}: {
  label: string;
  children: ReactNode;
  divider?: boolean;
  onPress?: () => void;
  trailing?: ReactNode;
  accessibilityLabel?: string;
  flag?: ReceiptFlag;
  error?: string;
}) {
  const content = (
    <View style={styles.fieldInner}>
      <View style={styles.fieldLine}>
        <AppText style={styles.rowLabel}>{label}</AppText>
        <View style={styles.flex}>{children}</View>
        {trailing}
      </View>
      {error ? (
        <View style={styles.inlineFlag}>
          <AlertCircleIcon size={12} color={colors.dangerText} />
          <AppText variant="small" color={colors.dangerText} style={styles.flex}>
            {error}
          </AppText>
        </View>
      ) : flag ? (
        <FlagLine flag={flag} />
      ) : null}
    </View>
  );
  const style = [styles.row, divider && styles.divider];
  if (!onPress) return <View style={style}>{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [...style, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

function Stepper({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (next: string) => void;
}) {
  const n = Number(value);
  const canDecrease = (toMilli(value) ?? 0n) > 1000n;
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => canDecrease && onChange(String(n - 1))}
        disabled={!canDecrease}
        accessibilityRole="button"
        accessibilityLabel={`Decrease quantity of ${label}`}
        hitSlop={8}
        style={[styles.stepButton, !canDecrease && styles.stepDisabled]}
      >
        <AppText style={styles.stepText}>−</AppText>
      </Pressable>
      <AppText style={styles.stepValue} accessibilityLabel={`Quantity ${value}`}>
        {value}
      </AppText>
      <Pressable
        onPress={() => n < 9999 && onChange(String(n + 1))}
        accessibilityRole="button"
        accessibilityLabel={`Increase quantity of ${label}`}
        hitSlop={8}
        style={styles.stepButton}
      >
        <AppText style={styles.stepText}>+</AppText>
      </Pressable>
    </View>
  );
}

function LinkButton({ icon, label, onPress }: { icon: ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.linkButton, pressed && styles.pressedText]}
    >
      {icon}
      <AppText style={styles.link}>{label}</AppText>
    </Pressable>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <AppText variant={strong ? 'rowTitle' : 'body'}>{label}</AppText>
      <AppText variant={strong ? 'rowTitle' : 'body'}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.screen, gap: spacing.md, paddingBottom: spacing.xxl },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  center: { textAlign: 'center' },
  empty: { flex: 1, padding: spacing.xxl, gap: spacing.md, justifyContent: 'center', alignItems: 'stretch' },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  simulated: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.input,
    backgroundColor: colors.warnBg,
    borderWidth: 1,
    borderColor: colors.warnBorder,
  },
  viewfinder: {
    height: 300,
    borderRadius: radius.pageCard,
    overflow: 'hidden',
    backgroundColor: colors.reviewViewfinder,
    borderWidth: 1,
    borderColor: colors.borderTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewfinderPill: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primaryBright },
  pillText: { ...font(700), fontSize: 10, letterSpacing: 0.5, color: colors.textStrong, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceMuted,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  chipLow: { backgroundColor: colors.warnBg },
  chipLabel: { ...font(500), fontSize: 12, color: colors.textStrong },
  chipValue: { ...font(600), fontSize: 12, color: colors.primaryChipText },
  chipValueLow: { color: colors.warnStrong },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderInput,
    borderRadius: radius.input,
    boxShadow: shadows.card,
  },
  summaryTile: {
    width: 44,
    height: 44,
    borderRadius: radius.iconTile,
    backgroundColor: colors.primaryChipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryRight: { alignItems: 'flex-end' },
  summaryTotal: { ...font(900), fontSize: 22, lineHeight: 28, color: colors.text },
  links: { flexDirection: 'row', justifyContent: 'space-between' },
  linkButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: spacing.sm },
  link: { ...font(600), fontSize: 14.5, color: colors.primaryLink },
  pressedText: { opacity: 0.6 },
  duplicate: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.input,
    backgroundColor: colors.warnBg,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderInput,
    borderRadius: radius.input,
    overflow: 'hidden',
  },
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minHeight: 56, justifyContent: 'center' },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.surfaceSubtle },
  fieldInner: { gap: 2 },
  fieldLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowLabel: { ...font(500), width: 96, fontSize: 14, color: colors.textMuted },
  input: { ...font(500), fontSize: 15, color: colors.text, paddingVertical: spacing.sm },
  money: { ...font(700) },
  value: { ...font(500), fontSize: 15, color: colors.text },
  placeholder: { ...font(500), fontSize: 15, color: colors.textFaint },
  inlineFlag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  itemsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  itemRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: spacing.sm },
  itemMain: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, minHeight: 44 },
  itemIndex: {
    width: 28,
    height: 28,
    marginTop: 2,
    borderRadius: 8,
    backgroundColor: colors.primaryChipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemIndexText: { ...font(700), fontSize: 11, color: colors.primaryChipText },
  itemNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemRight: { alignItems: 'flex-end', gap: 4 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderInput,
    borderRadius: radius.pill,
  },
  stepButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  stepDisabled: { opacity: 0.35 },
  stepText: { ...font(700), fontSize: 16, color: colors.textMuted },
  stepValue: { ...font(600), fontSize: 13, minWidth: 18, textAlign: 'center', color: colors.text },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg, minHeight: 52 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: 10 },
  mismatch: { padding: spacing.lg, paddingTop: spacing.xs, gap: spacing.sm },
  matchLine: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  formError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.input,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  footer: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
});
