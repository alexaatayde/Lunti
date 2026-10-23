import { useLocalSearchParams } from 'expo-router';

import { PlaceholderScreen } from '../../src/features/placeholder/PlaceholderScreen';

/** ExpenseForm: `?mode=add` (TxnForm) or `?mode=edit&id=…` (TxnEdit). */
export default function ExpenseFormScreen() {
  const { mode, id } = useLocalSearchParams<{ mode?: string; id?: string }>();
  const isEdit = mode === 'edit';
  return (
    <PlaceholderScreen
      title={isEdit ? 'Edit expense' : 'New expense'}
      eyebrow={isEdit ? `Edit mode · id ${id ?? '—'}` : 'Add mode'}
      designFile={isEdit ? 'TxnEdit' : 'TxnForm'}
      links={[{ label: 'Choose category', href: '/category-picker' }]}
      canGoBack
    />
  );
}
