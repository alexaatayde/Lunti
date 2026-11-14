/** Add or edit a grocery list item. Validation mirrors the API (ItemCreate / ItemUpdate). */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { ApiError } from '../../api/client';
import type { ItemCreate, ShoppingListItem } from '../../api/hooks';
import { AlertCircleIcon, AppText, BottomSheet, Button, TextField } from '../../components';
import { normalizeQuantity } from '../../lib/centavos';
import { colors, spacing } from '../../theme';

export const itemSchema = z.object({
  name: z.string().trim().min(1, 'Enter the item name.').max(120, 'Use 120 characters or fewer.'),
  quantity: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,3})?$/, 'Enter a number (up to 3 decimals).')
    .refine((v) => Number(v) > 0, 'Quantity must be more than 0.'),
  unit: z.string().trim().max(20, 'Use 20 characters or fewer.'),
  price: z
    .string()
    .trim()
    .regex(/^(\d+(\.\d{1,2})?)?$/, 'Enter an amount like 15.75.'),
});

export type ItemForm = z.infer<typeof itemSchema>;

export function toItemBody(form: ItemForm): ItemCreate {
  return {
    name: form.name.trim(),
    quantity: normalizeQuantity(form.quantity),
    unit: form.unit.trim() || null,
    est_price: form.price.trim() || null,
  };
}

export function ItemSheet({
  item,
  saving,
  deleting,
  onClose,
  onSave,
  onDelete,
}: {
  item: ShoppingListItem | null;
  saving: boolean;
  deleting?: boolean;
  onClose: () => void;
  onSave: (body: ItemCreate) => Promise<void>;
  onDelete?: () => void;
}) {
  const { control, handleSubmit, setError, setFocus, formState } = useForm<ItemForm>({
    resolver: zodResolver(itemSchema),
    defaultValues: {
      name: item?.name ?? '',
      quantity: item ? normalizeQuantity(item.quantity) : '1',
      unit: item?.unit ?? '',
      price: item?.est_price ?? '',
    },
  });

  const submit = handleSubmit(async (form) => {
    try {
      await onSave(toItemBody(form));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const field = error instanceof ApiError && error.status === 409 ? 'name' : 'root';
      setError(field, { message });
    }
  });

  // Keyboard order: Item → Quantity → Unit → Price → submit.
  const NEXT: Record<keyof ItemForm, keyof ItemForm | null> = {
    name: 'quantity',
    quantity: 'unit',
    unit: 'price',
    price: null,
  };
  const field = (name: keyof ItemForm, label: string, extra: object = {}) => (
    <Controller
      control={control}
      name={name}
      render={({ field: f, fieldState }) => (
        <TextField
          ref={f.ref}
          label={label}
          value={f.value}
          onChangeText={f.onChange}
          onBlur={f.onBlur}
          error={fieldState.error?.message}
          returnKeyType={NEXT[name] ? 'next' : 'done'}
          submitBehavior={NEXT[name] ? 'submit' : 'blurAndSubmit'}
          onSubmitEditing={() => {
            const next = NEXT[name];
            if (next) setFocus(next);
            else void submit();
          }}
          {...extra}
        />
      )}
    />
  );

  return (
    <BottomSheet
      visible
      onClose={onClose}
      eyebrow="Grocery list"
      title={item ? 'Edit item' : 'Add item'}
    >
      <View style={styles.form}>
        {field('name', 'Item', { autoFocus: !item, placeholder: 'e.g. Eggs (12)' })}
        <View style={styles.row}>
          <View style={styles.flex}>
            {field('quantity', 'Quantity', { keyboardType: 'decimal-pad' })}
          </View>
          <View style={styles.flex}>{field('unit', 'Unit', { placeholder: 'kg, pack…' })}</View>
        </View>
        {field('price', 'Estimated price each (₱, optional)', { keyboardType: 'decimal-pad' })}
        {formState.errors.root ? (
          <View style={styles.error} accessibilityLiveRegion="polite">
            <AlertCircleIcon size={16} color={colors.dangerText} />
            <AppText variant="body" color={colors.dangerText} style={styles.flex}>
              {formState.errors.root.message}
            </AppText>
          </View>
        ) : null}
        <Button label={item ? 'Save changes' : 'Add to list'} loading={saving} onPress={submit} />
        {item && onDelete ? (
          <Button label="Remove from list" variant="danger" loading={deleting} onPress={onDelete} />
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
  error: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
