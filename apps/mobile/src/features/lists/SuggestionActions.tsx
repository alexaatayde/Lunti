/**
 * Answers to a restock suggestion (AGENTS.md §7.4): Add to list, I still have some, and under
 * "More": bought it elsewhere, don't remind me, change date or quantity, not now. Used on the
 * Grocery list and on restock notifications (Notifications.html).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  useUnmuteProduct,
  useSuggestionFeedback,
  type FeedbackAction,
  type Suggestion,
  type SuggestionFeedback,
} from '../../api/hooks';
import { AppText, BottomSheet, Button, TextField } from '../../components';
import { fromDateKey, formatShortDate, localDateKey, todayKey } from '../../lib/dates';
import { showToast } from '../../stores/toast';
import { colors, font, radius, spacing } from '../../theme';
import { pickDate } from '../money/pickDate';

const DONE: Record<FeedbackAction, string> = {
  add_to_list: 'Added to your grocery list.',
  still_have: "Got it. We'll ask again later.",
  bought_elsewhere: "Noted. We'll remind you next cycle.",
  dont_remind: "We won't remind you about this item.",
  dismiss: 'Dismissed for now.',
  modify: 'Reminder updated.',
};

export function SuggestionActions({ suggestion }: { suggestion: Suggestion }) {
  const feedback = useSuggestionFeedback();
  const unmute = useUnmuteProduct();
  const [moreOpen, setMoreOpen] = useState(false);
  const [modifyOpen, setModifyOpen] = useState(false);
  const name = suggestion.product.name;

  const send = async (body: SuggestionFeedback) => {
    try {
      await feedback.mutateAsync({ id: suggestion.id, body });
      // Screens may close before Undo is tapped, so the undo uses the mutation's promise.
      const undo =
        body.action === 'dont_remind'
          ? () => {
              unmute.mutateAsync(suggestion.product.id).then(
                () => showToast(`Reminders for ${name} are back on.`),
                (error: Error) => showToast(`Couldn't undo. ${error.message}`),
              );
            }
          : undefined;
      showToast(DONE[body.action], { onUndo: undo });
      return true;
    } catch (error) {
      showToast(`Couldn't save that. ${(error as Error).message}`);
      return false;
    }
  };

  const more = (action: FeedbackAction) => {
    setMoreOpen(false);
    void send({ action });
  };

  return (
    <View style={styles.row}>
      <Pill
        label="Add to list"
        primary
        disabled={feedback.isPending}
        accessibilityLabel={`Add ${name} to list`}
        onPress={() => void send({ action: 'add_to_list' })}
      />
      <Pill
        label="I still have some"
        disabled={feedback.isPending}
        accessibilityLabel={`I still have some ${name}`}
        onPress={() => void send({ action: 'still_have' })}
      />
      <Pill
        label="More"
        disabled={feedback.isPending}
        accessibilityLabel={`More options for ${name}`}
        onPress={() => setMoreOpen(true)}
      />

      <BottomSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        eyebrow="Restock"
        title={name}
      >
        <View style={styles.sheet}>
          <Button
            label="I bought it elsewhere"
            variant="secondary"
            onPress={() => more('bought_elsewhere')}
          />
          <Button
            label="Change date or quantity"
            variant="secondary"
            onPress={() => {
              setMoreOpen(false);
              setModifyOpen(true);
            }}
          />
          <Button label="Not now" variant="secondary" onPress={() => more('dismiss')} />
          <Button
            label="Don't remind me about this"
            variant="ghost"
            onPress={() => more('dont_remind')}
          />
        </View>
      </BottomSheet>

      {modifyOpen ? (
        <ModifySheet
          suggestion={suggestion}
          saving={feedback.isPending}
          onClose={() => setModifyOpen(false)}
          onSave={async (body) => {
            if (await send(body)) setModifyOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}

function ModifySheet({
  suggestion,
  saving,
  onClose,
  onSave,
}: {
  suggestion: Suggestion;
  saving: boolean;
  onClose: () => void;
  onSave: (body: SuggestionFeedback) => void;
}) {
  const today = todayKey();
  const [day, setDay] = useState(
    suggestion.predicted_date < today ? today : suggestion.predicted_date,
  );
  const [quantity, setQuantity] = useState(suggestion.quantity ?? '1');
  const valid = /^\d+(\.\d{1,3})?$/.test(quantity.trim()) && Number(quantity) > 0;

  return (
    <BottomSheet
      visible
      onClose={onClose}
      eyebrow="Change reminder"
      title={suggestion.product.name}
    >
      <View style={styles.sheet}>
        <Pressable
          onPress={async () => {
            const picked = await pickDate({
              value: fromDateKey(day),
              minimumDate: fromDateKey(today),
            });
            if (picked) setDay(localDateKey(picked));
          }}
          accessibilityRole="button"
          accessibilityLabel={`Remind me on ${formatShortDate(fromDateKey(day))}. Change date`}
          style={styles.dateRow}
        >
          <AppText variant="label">Remind me on</AppText>
          <AppText variant="body" color={colors.text}>
            {day === today ? 'Today' : formatShortDate(fromDateKey(day))}
          </AppText>
        </Pressable>
        <TextField
          label="Quantity"
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="decimal-pad"
          error={valid ? undefined : 'Enter a quantity above 0 (up to 3 decimals).'}
        />
        <Button
          label="Save"
          loading={saving}
          disabled={!valid}
          onPress={() =>
            onSave({ action: 'modify', predicted_date: day, quantity: quantity.trim() })
          }
        />
      </View>
    </BottomSheet>
  );
}

function Pill({
  label,
  primary,
  disabled,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.pill,
        primary ? styles.pillPrimary : styles.pillSecondary,
        (pressed || disabled) && styles.pressed,
      ]}
    >
      <AppText style={[styles.pillText, primary && styles.pillTextPrimary]}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillPrimary: { backgroundColor: colors.primary },
  pillSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderInput,
  },
  pillText: { ...font(600), fontSize: 14, color: colors.textStrong },
  pillTextPrimary: { ...font(700), color: colors.textOnPrimary },
  pressed: { opacity: 0.7 },
  sheet: { gap: spacing.md },
  dateRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.borderInput,
  },
});
