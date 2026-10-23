import { PlaceholderScreen } from '../../../src/features/placeholder/PlaceholderScreen';

export default function TransactionsScreen() {
  return (
    <PlaceholderScreen
      title="Transactions"
      designFile="Transactions"
      links={[
        { label: "Add transaction (sheet)", href: "/add-transaction" },
        { label: "Transaction detail", href: "/transactions/sample-id" },
      ]}
      inTabs
    />
  );
}
