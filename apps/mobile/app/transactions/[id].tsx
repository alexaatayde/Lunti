import { useLocalSearchParams } from 'expo-router';

import { PlaceholderScreen } from '../../src/features/placeholder/PlaceholderScreen';

/** TransactionDetail keeps the bottom nav (DESIGN_HANDOFF.md §4). */
export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <PlaceholderScreen
      title="Transaction detail"
      eyebrow={`Transaction ${id}`}
      designFile="TxnDetail"
      links={[
        {
          label: 'Edit',
          href: { pathname: '/expense-form', params: { mode: 'edit', id } },
        },
      ]}
      nav="transactions"
      canGoBack
    />
  );
}
