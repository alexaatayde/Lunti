/**
 * AddTransactionSheet as a route (deep links). The Transactions "+" button opens the same
 * sheet in place, over the list.
 */
import { router } from 'expo-router';
import { View } from 'react-native';

import { AddTransactionSheet } from '../../src/features/money/AddTransactionSheet';
import { colors } from '../../src/theme';

export default function AddTransactionScreen() {
  const close = () => (router.canGoBack() ? router.back() : router.replace('/transactions'));
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AddTransactionSheet
        visible
        onClose={close}
        onScan={() => router.replace('/scan/camera')}
        onManual={() =>
          router.replace({ pathname: '/expense-form', params: { mode: 'add' } })
        }
      />
    </View>
  );
}
