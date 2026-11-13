import { useCallback } from 'react';

import {
  useCreateTransaction,
  useDeleteTransaction,
  type TransactionDetail,
} from '../../api/hooks';
import { uuidv4 } from '../../lib/uuid';
import { showToast } from '../../stores/toast';

export const SAVED_MESSAGE = 'Transaction saved. Budget updated.';
export const DELETED_MESSAGE = 'Transaction deleted. Budget updated.';

/**
 * Deletes a transaction, then shows "Transaction deleted. Budget updated." with Undo
 * (DESIGN_HANDOFF.md §5.5). Undo records the same expense again, so budgets update again.
 * Scanned receipts have line items that can't be re-created this way, so they get no Undo.
 */
export function useDeleteWithUndo() {
  const remove = useDeleteTransaction();
  const create = useCreateTransaction();

  const run = useCallback(
    async (txn: TransactionDetail) => {
      await remove.mutateAsync(txn.id);
      // The screen that deleted has usually closed by the time Undo is tapped, so this uses
      // the mutation's promise (per-call callbacks don't run after the screen unmounts).
      // One restore per delete, however many times Undo is pressed (a fast double tap
      // could otherwise fire twice before the toast hides and save the expense twice).
      let undone = false;
      // The restore is a new expense (the deleted one's key is spent), with its own key.
      const restoreKey = uuidv4();
      const undo =
        txn.source === 'manual'
          ? () => {
              if (undone) return;
              undone = true;
              create
                .mutateAsync({
                  body: {
                    amount: txn.amount,
                    category_id: txn.category.id,
                    occurred_at: txn.occurred_at,
                    merchant: txn.merchant,
                    note: txn.note,
                  },
                  idempotencyKey: restoreKey,
                })
                .then(
                  () => showToast('Transaction restored. Budget updated.'),
                  (error: Error) => showToast(`Couldn't restore it. ${error.message}`),
                );
            }
          : undefined;
      showToast(DELETED_MESSAGE, { onUndo: undo });
    },
    [remove, create],
  );

  return { run, isPending: remove.isPending, error: remove.error, reset: remove.reset };
}
