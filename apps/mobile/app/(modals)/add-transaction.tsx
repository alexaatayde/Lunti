import { PlaceholderScreen } from '../../src/features/placeholder/PlaceholderScreen';

export default function AddTransactionScreen() {
  return (
    <PlaceholderScreen
      title="Add transaction"
      eyebrow="Bottom sheet placeholder"
      designFile="TxnAddSheet"
      links={[
        { label: "Scan a receipt", href: "/scan/camera", replace: true },
        { label: "Enter manually", href: "/expense-form?mode=add", replace: true },
      ]}
      canGoBack
    />
  );
}
