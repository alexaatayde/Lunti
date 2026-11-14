/**
 * New / edit budget (BudgetCreate.html, SRS 3.1.3). `?id=` edits an existing budget.
 * Earlier visual generation: layout kept, drawn with the current tokens (DESIGN_HANDOFF.md §6).
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
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
  useBudget,
  useCategories,
  useCreateBudget,
  useDeleteBudget,
  usePreferences,
  useUpdateBudget,
  type BudgetStatus,
} from '../../src/api/hooks';
import {
  AlertCircleIcon,
  AlertDialog,
  AppText,
  Button,
  CalendarIcon,
  Card,
  Checkbox,
  ChevronDownIcon,
  ChevronLeftIcon,
  SegmentedControl,
} from '../../src/components';
import { PERIOD_LABELS } from '../../src/features/money/budgetDisplay';
import { CategoryPickerSheet, OVERALL } from '../../src/features/money/CategoryPickerSheet';
import { pickDate } from '../../src/features/money/pickDate';
import { budgetSchema, PERIODS, type BudgetFormValues } from '../../src/features/money/schemas';
import { ErrorState, LoadingBlocks } from '../../src/features/money/StateViews';
import {
  daysInclusive,
  formatLongDate,
  fromDateKey,
  localDateKey,
  todayKey,
} from '../../src/lib/dates';
import { formatMoney, toAmountString } from '../../src/lib/money';
import { showToast } from '../../src/stores/toast';
import { colors, font, radius, shadows, spacing } from '../../src/theme';

const API_FIELDS: Record<string, FieldPath<BudgetFormValues>> = {
  category_id: 'categoryId',
  period_type: 'periodType',
  start_date: 'startDate',
  end_date: 'endDate',
  limit_amount: 'limit',
};

const RESETS: Record<string, string> = {
  daily: 'Resets every day.',
  weekly: 'Resets every week (Monday to Sunday).',
  monthly: 'Resets on the 1st of every month.',
};

function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/budget');
}

export default function BudgetFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useBudget(id);
  const title = id ? 'Edit budget' : 'New budget';

  if (id && existing.isPending) {
    return (
      <Shell title={title}>
        <LoadingBlocks label="Loading budget" heights={[56, 52, 64, 120]} />
      </Shell>
    );
  }
  if (id && existing.isError) {
    return (
      <Shell title={title}>
        <ErrorState
          message={existing.error.message}
          onRetry={() => existing.refetch()}
          retrying={existing.isFetching}
        />
      </Shell>
    );
  }
  return <BudgetForm existing={id ? existing.data : undefined} />;
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
          accessibilityLabel="Back to Budgets"
          hitSlop={8}
          style={styles.back}
        >
          <ChevronLeftIcon size={20} color={colors.textStrong} />
          <AppText style={styles.backText}>Budgets</AppText>
        </Pressable>
        <AppText style={styles.headerTitle} accessibilityRole="header">
          {title}
        </AppText>
        <View style={styles.back} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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

function BudgetForm({ existing }: { existing?: BudgetStatus }) {
  const categories = useCategories();
  const preferences = usePreferences();
  const create = useCreateBudget();
  const update = useUpdateBudget(existing?.budget.id ?? '');
  const remove = useDeleteBudget();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [limitFocused, setLimitFocused] = useState(false);

  const b = existing?.budget;
  const {
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
  } = useForm<BudgetFormValues>({
    resolver: zodResolver(budgetSchema),
    defaultValues: b
      ? {
          categoryId: b.category?.id ?? OVERALL,
          periodType: b.period_type,
          startDate: b.start_date,
          endDate: b.end_date ?? null,
          limit: b.limit_amount,
          alertsEnabled: b.alerts_enabled,
        }
      : {
          categoryId: '',
          periodType: 'monthly',
          startDate: todayKey(),
          endDate: null,
          limit: '',
          alertsEnabled: true,
        },
  });

  const categoryId = useWatch({ control, name: 'categoryId' });
  const periodType = useWatch({ control, name: 'periodType' });
  const startDate = useWatch({ control, name: 'startDate' });
  const endDate = useWatch({ control, name: 'endDate' });
  const categoryName =
    categoryId === OVERALL
      ? 'All spending (overall)'
      : (categories.data?.find((c) => c.id === categoryId)?.name ?? b?.category?.name);
  const pct = preferences.data?.budget_alert_pct ?? 90;
  const saving = create.isPending || update.isPending;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const body = {
      category_id: values.categoryId === OVERALL ? null : values.categoryId,
      period_type: values.periodType,
      start_date: values.startDate,
      end_date: values.periodType === 'custom' ? values.endDate : (b?.end_date ?? null),
      limit_amount: toAmountString(values.limit),
      alerts_enabled: values.alertsEnabled,
    };
    try {
      if (existing) await update.mutateAsync(body);
      else await create.mutateAsync(body);
      showToast(existing ? 'Budget updated.' : 'Budget saved.');
      close();
    } catch (error) {
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
      await remove.mutateAsync(existing.budget.id);
      setConfirmDelete(false);
      showToast('Budget deleted. Your transactions are kept.');
      close();
    } catch (error) {
      setConfirmDelete(false);
      setFormError(error instanceof Error ? error.message : String(error));
    }
  };

  const chooseDate = async (field: 'startDate' | 'endDate') => {
    const current = (field === 'startDate' ? startDate : endDate) ?? startDate;
    const picked = await pickDate({
      value: fromDateKey(current),
      minimumDate: field === 'endDate' ? fromDateKey(startDate) : undefined,
    });
    if (picked) setValue(field, localDateKey(picked), { shouldValidate: true });
  };

  return (
    <Shell
      title={existing ? 'Edit budget' : 'New budget'}
      footer={
        <>
          <Button label="Save budget" onPress={onSubmit} loading={saving} />
          {existing ? (
            <Pressable
              onPress={() => setConfirmDelete(true)}
              accessibilityRole="button"
              accessibilityLabel="Delete budget"
              style={styles.deleteLink}
            >
              <AppText style={styles.deleteText}>Delete budget</AppText>
            </Pressable>
          ) : null}
        </>
      }
    >
      <Section label="Category">
        <Pressable
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Category, ${categoryName ?? 'not chosen'}. Change`}
          style={({ pressed }) => [
            styles.select,
            !!errors.categoryId && styles.inputError,
            pressed && styles.pressed,
          ]}
        >
          <AppText style={categoryName ? styles.selectText : styles.placeholder}>
            {categoryName ?? 'Choose a category'}
          </AppText>
          <ChevronDownIcon size={18} color={colors.text} />
        </Pressable>
        <FieldError message={errors.categoryId?.message} />
      </Section>

      <Section label="Period">
        <Controller
          control={control}
          name="periodType"
          render={({ field }) => (
            <SegmentedControl
              accessibilityLabel="Period"
              value={field.value}
              onChange={field.onChange}
              options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
            />
          )}
        />
        {periodType !== 'custom' ? (
          <AppText variant="meta">{RESETS[periodType]}</AppText>
        ) : null}
      </Section>

      <View style={styles.dates}>
        <View style={styles.flex}>
          <Section label={periodType === 'custom' ? 'Start date' : 'Starts'}>
            <DateButton
              label="Start date"
              value={startDate}
              onPress={() => chooseDate('startDate')}
              invalid={!!errors.startDate}
            />
          </Section>
        </View>
        {periodType === 'custom' ? (
          <View style={styles.flex}>
            <Section label="End date">
              <DateButton
                label="End date"
                value={endDate}
                onPress={() => chooseDate('endDate')}
                invalid={!!errors.endDate}
              />
            </Section>
          </View>
        ) : null}
      </View>
      <FieldError message={errors.endDate?.message ?? errors.startDate?.message} />
      {periodType === 'custom' && endDate && endDate >= startDate ? (
        <AppText variant="meta">Covers {daysInclusive(startDate, endDate)} days.</AppText>
      ) : null}

      <Section label="Spending limit">
        <Controller
          control={control}
          name="limit"
          render={({ field }) => (
            <View
              style={[
                styles.limit,
                limitFocused && styles.limitFocused,
                !!errors.limit && styles.inputError,
              ]}
            >
              <AppText style={styles.peso}>₱</AppText>
              <TextInput
                value={field.value}
                onChangeText={(text) => {
                  const cleaned = text.replace(/[^0-9.]/g, '');
                  if (/^\d*(\.\d{0,2})?$/.test(cleaned)) field.onChange(cleaned);
                }}
                onFocus={() => setLimitFocused(true)}
                onBlur={() => {
                  setLimitFocused(false);
                  field.onBlur();
                }}
                keyboardType="decimal-pad"
                inputMode="decimal"
                placeholder="0.00"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Spending limit in pesos"
                style={styles.limitInput}
              />
            </View>
          )}
        />
        <FieldError message={errors.limit?.message} />
      </Section>

      <Controller
        control={control}
        name="alertsEnabled"
        render={({ field }) => (
          <Card size="list" style={styles.alerts}>
            <Checkbox
              checked={field.value}
              onChange={field.onChange}
              alignTop
              accessibilityLabel={`Budget alerts: notify me at ${pct}% and when the limit is reached or exceeded`}
              label={
                <View style={styles.flex}>
                  <AppText variant="cardTitle">Budget alerts</AppText>
                  <AppText variant="body">
                    Notify me at {pct}%, and when the limit is reached or exceeded
                  </AppText>
                </View>
              }
            />
          </Card>
        )}
      />

      <AppText variant="meta">Remaining balance is calculated from your saved transactions only.</AppText>

      {formError ? (
        <View style={styles.formError} accessibilityLiveRegion="polite">
          <AlertCircleIcon size={16} color={colors.dangerText} />
          <AppText variant="body" color={colors.dangerText} style={styles.flex}>
            {formError}
          </AppText>
        </View>
      ) : null}

      {existing ? (
        <AlertDialog
          visible={confirmDelete}
          title="Delete this budget?"
          summary={{
            label: existing.budget.label,
            value: formatMoney(existing.budget.limit_amount),
          }}
          message="Your transactions stay. Only this spending limit and its alerts are removed."
          confirmLabel="Delete"
          cancelLabel="Keep it"
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
          loading={remove.isPending}
        />
      ) : null}

      <CategoryPickerSheet
        visible={pickerOpen}
        includeOverall
        value={categoryId}
        onClose={() => setPickerOpen(false)}
        onSelect={(picked) => {
          setValue('categoryId', picked === OVERALL ? OVERALL : picked.id, {
            shouldValidate: true,
          });
          setPickerOpen(false);
        }}
      />
    </Shell>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText style={styles.sectionLabel}>{label}</AppText>
      {children}
    </View>
  );
}

function DateButton({
  label,
  value,
  onPress,
  invalid,
}: {
  label: string;
  value: string | null;
  onPress: () => void;
  invalid?: boolean;
}) {
  const text = value ? formatLongDate(fromDateKey(value)) : 'Choose';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${text}. Change`}
      style={({ pressed }) => [styles.select, invalid && styles.inputError, pressed && styles.pressed]}
    >
      <AppText style={value ? styles.selectText : styles.placeholder}>{text}</AppText>
      <CalendarIcon size={18} color={colors.textFaint} />
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
    minHeight: 56,
    paddingHorizontal: spacing.screen,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  back: { width: 96, flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44 },
  backText: { ...font(500), fontSize: 16, color: colors.textStrong },
  headerTitle: { ...font(700), flex: 1, textAlign: 'center', fontSize: 18, color: colors.text },
  content: { padding: spacing.screen, gap: spacing.lg, paddingBottom: spacing.xxl },
  section: { gap: spacing.sm },
  sectionLabel: { ...font(700), fontSize: 15, color: colors.text },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.borderInput,
    backgroundColor: colors.surface,
  },
  selectText: { ...font(500), fontSize: 16, color: colors.text, flexShrink: 1 },
  placeholder: { ...font(500), fontSize: 16, color: colors.textMuted },
  pressed: { opacity: 0.8 },
  inputError: { borderWidth: 1.5, borderColor: colors.dangerText },
  dates: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
  limit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 60,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.borderInput,
    backgroundColor: colors.surface,
  },
  limitFocused: { borderWidth: 1.5, borderColor: colors.primary, boxShadow: shadows.focusRing },
  peso: { ...font(800), fontSize: 22, color: colors.textStrong },
  limitInput: { ...font(800), flex: 1, fontSize: 24, color: colors.text, padding: 0 },
  alerts: { padding: spacing.lg },
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
  fieldError: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deleteLink: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  deleteText: { ...font(700), fontSize: 15, color: colors.dangerText },
  footer: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
});
