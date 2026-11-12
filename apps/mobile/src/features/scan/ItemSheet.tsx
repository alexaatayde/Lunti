/**
 * Edit (or add) one receipt item: name, quantity, unit price, item discount.
 * Render with `key` = the item's key so each opening starts from that item's values.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, BottomSheet, Button, TextField } from '../../components';
import { fromCentavos, lineTotal } from '../../lib/centavos';
import { formatMoney } from '../../lib/money';
import { colors, spacing } from '../../theme';
import { itemSchema, type ReviewItem } from './reviewModel';

export function ItemSheet({
  item,
  isNew,
  onSave,
  onRemove,
  onClose,
}: {
  /** null = closed. */
  item: ReviewItem | null;
  isNew: boolean;
  onSave: (item: ReviewItem) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ReviewItem | null>(item);
  const [errors, setErrors] = useState<Partial<Record<keyof ReviewItem, string>>>({});

  const set = (field: keyof ReviewItem) => (value: string) =>
    setDraft((d) => (d ? { ...d, [field]: value } : d));

  const save = () => {
    if (!draft) return;
    const parsed = itemSchema.safeParse(draft);
    if (!parsed.success) {
      const next: Partial<Record<keyof ReviewItem, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ReviewItem;
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    const total = lineTotal(draft.quantity, draft.unitPrice, draft.discount);
    if (total !== null && total < 0n) {
      setErrors({ discount: "The discount is more than the item's price." });
      return;
    }
    onSave(draft);
  };

  const total = draft ? lineTotal(draft.quantity, draft.unitPrice, draft.discount) : null;

  return (
    <BottomSheet
      visible={!!item}
      onClose={onClose}
      eyebrow={isNew ? 'Add item' : 'Edit item'}
      title={isNew ? 'A missing item' : 'Fix this item'}
    >
      {draft ? (
        <View style={styles.body}>
          <TextField
            label="Item name"
            value={draft.name}
            onChangeText={set('name')}
            maxLength={120}
            error={errors.name}
            autoFocus={isNew}
          />
          <View style={styles.row}>
            <View style={styles.flex}>
              <TextField
                label={draft.unit ? `Quantity (${draft.unit})` : 'Quantity'}
                value={draft.quantity}
                onChangeText={set('quantity')}
                keyboardType="decimal-pad"
                error={errors.quantity}
              />
            </View>
            <View style={styles.flex}>
              <TextField
                label="Unit price (₱)"
                value={draft.unitPrice}
                onChangeText={set('unitPrice')}
                keyboardType="decimal-pad"
                error={errors.unitPrice}
              />
            </View>
          </View>
          <TextField
            label="Item discount (₱)"
            value={draft.discount}
            onChangeText={set('discount')}
            keyboardType="decimal-pad"
            placeholder="0.00"
            error={errors.discount}
          />
          <AppText variant="meta" accessibilityLiveRegion="polite">
            Item total:{' '}
            <AppText variant="meta" color={colors.text}>
              {total !== null && total >= 0n ? formatMoney(fromCentavos(total)) : '—'}
            </AppText>
          </AppText>
          <Button label={isNew ? 'Add item' : 'Save item'} onPress={save} />
          {isNew ? (
            <Button label="Cancel" variant="ghost" onPress={onClose} />
          ) : (
            <Button label="Remove item" variant="danger" onPress={onRemove} />
          )}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, marginTop: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
});
