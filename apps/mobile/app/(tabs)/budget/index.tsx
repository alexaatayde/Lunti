import { PlaceholderScreen } from '../../../src/features/placeholder/PlaceholderScreen';

export default function BudgetScreen() {
  return (
    <PlaceholderScreen
      title="Budget"
      designFile="Budget"
      links={[
        { label: "New budget", href: "/budget/new" },
        { label: "Profile", href: "/profile" },
      ]}
      inTabs
    />
  );
}
