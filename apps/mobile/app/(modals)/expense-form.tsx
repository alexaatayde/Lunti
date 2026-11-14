/**
 * ExpenseForm: `?mode=add` (TxnForm.html) or `?mode=edit&id=…` (TxnEdit.html). SRS 3.1.1.
 * Saving recalculates budgets on the server; the toast reports it.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch, type FieldPath } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '../../src/api/client';
import {
  KEY_REUSED,
  useCategories,
  useCreateTransaction,
  useTransaction,
  useUpdateTransaction,
  type TransactionDetail,
  type TransactionSaved,
} from '../../src/api/hooks';
import {
  AlertCircleIcon,
  AlertDialog,
  AmountInput,
  AppText,
  Button,
  CalendarIcon,
  Card,
  CheckIcon,
  ChevronRightIcon,
  Chip,
  InfoIcon,
  ListIcon,
} from '../../src/components';
import { alertText } from '../../src/features/money/budgetDisplay';
import { categoryColor } from '../../src/features/money/CategoryIcon';
import { CategoryPickerSheet, OVERALL } from '../../src/features/money/CategoryPickerSheet';
import { pickDateTime } from '../../src/features/money/pickDate';
import { expenseSchema, type ExpenseFormValues } from '../../src/features/money/schemas';
import { ErrorState, LoadingBlocks } from '../../src/features/money/StateViews';
import {
  SAVED_MESSAGE,
  useDeleteWithUndo,
} from '../../src/features/money/useDeleteWithUndo';
import { formatMoney, toAmountString } from '../../src/lib/money';
import { uuidv4 } from '../../src/lib/uuid';
import { formatRelativeDay, formatTime } from '../../src/lib/dates';
import { showToast } from '../../src/stores/toast';
import { colors, font, radius, spacing } from '../../src/theme';

const API_FIELDS: Record<string, FieldPath<ExpenseFormValues>> = {
  amount: 'amount',
  category_id: 'categoryId',
  occurred_at: 'occurredAt',
  merchant: 'merchant',
  note: 'note',
};

function savedMessage(saved: TransactionSaved) {
  const alert = saved.budget_alerts[0];
  return alert ? `${SAVED_MESSAGE} ${alertText(alert)}` : SAVED_MESSAGE;
}

export default function ExpenseFormScreen() {
  const { mode, id } = useLocalSearchParams<{ mode?: string; id?: string }>();
  const isEdit = mode === 'edit' && !!id;
  const existing = useTransaction(isEdit ? id : undefined);

  if (isEdit && existing.isPending) {
    return (
      <Shell title="Edit transaction">
        <LoadingBlocks label="Loading transaction" heights={[150, 260]} />
      </Shell>
    );
  }
  if (isEdit && existing.isError) {
    return (
      <Shell title="Edit transaction">
        <ErrorState
          message={existing.error.message}
          onRetry={() => existing.refetch()}
          retrying={existing.isFetching}
        />
      </Shell>
    );
  }
  return <ExpenseForm existing={isEdit ? existing.data : undefined} />;
}

function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/transactions');
}

function Shell({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          hitSlop={8}
          style={styles.cancel}
        >
          <AppText style={styles.cancelText}>Cancel</AppText>
        </Pressable>
        <AppText style={styles.headerTitle} accessibilityRole="header" numberOfLines={1}>
          {title}
        </AppText>
        <View style={styles.cancel} />
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {footer ? (
        <View style={[styles.footer, { paddingBottom: spacing.lg + insets.bottom }]}>
          {footer}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function ExpenseForm({ existing }: { existing?: TransactionDetail }) {
  const isEdit = !!existing;
  const categories = useCategories();
  const create = useCreateTransaction();
  const update = useUpdateTransaction(existing?.id ?? '');
  const deletion = useDeleteWithUndo();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // One idempotency key per new expense, kept across every Save attempt while this form is
  // open: if a save timed out after the server recorded it, saving again returns that
  // transaction instead of a duplicate (Phase 8B).
  const [createKey, setCreateKey] = useState(uuidv4);
  // A scanned total is the sum of its items; it changes when the items change (step 4).
  const amountLocked = existing?.source === 'receipt' && existing.item_count > 0;

  const {
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
  } = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: existing
      ? {
          amount: existing.amount,
          categoryId: existing.category.id,
          occurredAt: new Date(existing.occurred_at),
          merchant: existing.merchant ?? '',
          note: existing.note ?? '',
        }
      : { amount: '', categoryId: '', occurredAt: new Date(), merchant: '', note: '' },
  });

  // New expenses start in the first category (Groceries) once categories load.
  const categoryId = useWatch({ control, name: 'categoryId' });
  useEffect(() => {
    if (!categoryId && categories.data?.length) setValue('categoryId', categories.data[0].id);
  }, [categoryId, categories.data, setValue]);
  const category = categories.data?.find((c) => c.id === categoryId) ?? existing?.category;

  const saving = create.isPending || update.isPending;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const body = {
      amount: toAmountString(values.amount),
      category_id: values.categoryId,
      occurred_at: values.occurredAt.toISOString(),
      merchant: values.merchant.trim() || null,
      note: values.note.trim() || null,
    };
    try {
      if (existing) {
        const { amount, ...rest } = body;
        const saved = await update.mutateAsync(amountLocked ? rest : { amount, ...rest });
        showToast(savedMessage(saved));
      } else {
        const saved = await create.mutateAsync({ body, idempotencyKey: createKey });
        showToast(savedMessage(saved));
      }
      close();
    } catch (error) {
      // An earlier attempt was saved with different details. The message says so; saving
      // again after that is a deliberate new expense, so it gets a new key.
      if (error instanceof ApiError && error.problem?.type === KEY_REUSED) setCreateKey(uuidv4());
      const fieldErrors = error instanceof ApiError ? (error.problem?.errors ?? []) : [];
      let placed = false;
      for (const fe of fieldErrors) {
        const field = API_FIELDS[fe.field];
        if (field) {
          setError(field, { message: fe.message });
          placed = true;
        }
      }
      if (!placed) setFormError(error instanceof Error ? error.message : String(error));
    }
  });

  const onDelete = async () => {
    if (!existing) return;
    try {
      await deletion.run(existing);
      setConfirmDelete(false);
      router.dismissTo('/transactions');
    } catch {
      setConfirmDelete(false);
    }
  };

  return (
    <Shell
      title={isEdit ? 'Edit transaction' : 'New expense'}
      footer={
        <>
          <Button
            label={isEdit ? 'Save changes' : 'Save expense'}
            onPress={onSubmit}
            loading={saving}
            leftIcon={<CheckIcon size={18} color={colors.textOnPrimary} strokeWidth={2.4} />}
          />
          {isEdit ? (
            <Pressable
              onPress={() => setConfirmDelete(true)}
              accessibilityRole="button"
              accessibilityLabel="Delete transaction"
              style={styles.deleteLink}
            >
              <AppText style={styles.deleteText}>Delete transaction</AppText>
            </Pressable>
          ) : null}
        </>
      }
    >
      <Controller
        control={control}
        name="amount"
        render={({ field }) =>
          amountLocked ? (
            <View>
              <AmountInput value={field.value} onChangeText={() => {}} />
              <AppText variant="meta" color={colors.primaryLink} style={styles.center}>
                Total from your scanned receipt
              </AppText>
            </View>
          ) : (
            <AmountInput value={field.value} onChangeText={field.onChange} autoFocus={!isEdit} />
          )
        }
      />
      <FieldError message={errors.amount?.message} />

      <Card size="list" padding={0}>
        <Controller
          control={control}
          name="merchant"
          render={({ field }) => (
            <FieldRow label="Store">
              <TextInput
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                placeholder="Where did you buy it?"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Store"
                maxLength={120}
                style={styles.input}
              />
            </FieldRow>
          )}
        />
        <FieldRow
          label="Category"
          divider
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
          name="occurredAt"
          render={({ field }) => (
            <FieldRow
              label="Date"
              divider
              onPress={async () => {
                const picked = await pickDateTime({
                  value: field.value,
                  maximumDate: new Date(),
                });
                if (picked) field.onChange(picked);
              }}
              accessibilityLabel={`Date, ${formatRelativeDay(field.value)} ${formatTime(field.value)}. Change`}
              trailing={<CalendarIcon size={20} color={colors.textFaint} />}
            >
              <AppText style={styles.value} numberOfLines={1}>
                {formatRelativeDay(field.value)} · {formatTime(field.value)}
              </AppText>
            </FieldRow>
          )}
        />
        <Controller
          control={control}
          name="note"
          render={({ field }) => (
            <FieldRow label="Note" divider>
              <TextInput
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                placeholder="Optional"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Note"
                maxLength={500}
                style={styles.input}
              />
            </FieldRow>
          )}
        />
      </Card>
      <FieldError message={errors.categoryId?.message} />
      <FieldError message={errors.occurredAt?.message} />
      <FieldError message={errors.merchant?.message} />
      <FieldError message={errors.note?.message} />

      {existing && existing.item_count > 0 ? (
        <Card size="list" style={styles.items}>
          <View style={styles.itemsTile}>
            <ListIcon size={20} color={colors.textStrong} />
          </View>
          <View style={styles.flex}>
            <AppText variant="rowTitle">Items</AppText>
            <AppText variant="meta">
              {existing.item_count} items from your receipt
            </AppText>
          </View>
        </Card>
      ) : null}

      <View style={styles.hint}>
        <InfoIcon size={16} color={colors.primary} />
        <AppText variant="meta" style={styles.flex}>
          Your budgets and analytics update as soon as you save.
        </AppText>
      </View>

      {formError ? (
        <View style={styles.formError} accessibilityLiveRegion="polite">
          <AlertCircleIcon size={16} color={colors.dangerText} />
          <AppText variant="body" color={colors.dangerText} style={styles.flex}>
            {formError}
          </AppText>
        </View>
      ) : null}

      <CategoryPickerSheet
        visible={pickerOpen}
        value={categoryId}
        onClose={() => setPickerOpen(false)}
        onSelect={(picked) => {
          if (picked !== OVERALL) {
            setValue('categoryId', picked.id, { shouldValidate: true });
          }
          setPickerOpen(false);
        }}
      />

      {existing ? (
        <AlertDialog
          visible={confirmDelete}
          title="Delete this transaction?"
          summary={{
            label: existing.merchant ?? existing.category.name,
            value: formatMoney(existing.amount),
          }}
          message="It will be removed from your history, and your budgets will be updated."
          confirmLabel="Delete"
          cancelLabel="Keep it"
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
          loading={deletion.isPending}
        />
      ) : null}
    </Shell>
  );
}

function FieldRow({
  label,
  children,
  divider,
  onPress,
  trailing,
  accessibilityLabel,
}: {
  label: string;
  children: ReactNode;
  divider?: boolean;
  onPress?: () => void;
  trailing?: ReactNode;
  accessibilityLabel?: string;
}) {
  const content = (
    <>
      <AppText style={styles.rowLabel}>{label}</AppText>
      <View style={styles.rowValue}>{children}</View>
      {trailing}
    </>
  );
  if (!onPress) return <View style={[styles.row, divider && styles.divider]}>{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <View style={styles.fieldError} accessibilityLiveRegion="polite">
      <AlertCircleIcon size={14} color={colors.dangerText} strokeWidth={2.2} />
      <AppText variant="meta" color={colors.dangerText}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.screen,
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cancel: { width: 72, minHeight: 44, justifyContent: 'center' },
  cancelText: { ...font(500), fontSize: 15, color: colors.textBody },
  headerTitle: { ...font(700), flex: 1, textAlign: 'center', fontSize: 17, color: colors.text },
  content: { padding: spacing.screen, gap: spacing.md, paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.surface,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.surfaceSubtle },
  rowLabel: { ...font(500), width: 84, fontSize: 14, color: colors.textMuted },
  rowValue: { flex: 1, minWidth: 0 },
  input: { ...font(500), fontSize: 15, color: colors.text, paddingVertical: spacing.md },
  value: { ...font(500), fontSize: 15, color: colors.text },
  placeholder: { ...font(500), fontSize: 15, color: colors.textMuted },
  center: { textAlign: 'center', marginTop: spacing.xs },
  items: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  itemsTile: {
    width: 40,
    height: 40,
    borderRadius: radius.iconTile,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 4 },
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
  fieldError: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  footer: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  deleteLink: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  deleteText: { ...font(700), fontSize: 15, color: colors.dangerText },
});
