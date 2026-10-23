import { PlaceholderScreen } from '../../../src/features/placeholder/PlaceholderScreen';

export default function MealsScreen() {
  return (
    <PlaceholderScreen
      title="Meals"
      designFile="Meals"
      links={[
        { label: "Grocery list", href: "/meals/grocery-list" },
        { label: "Pantry", href: "/meals/pantry" },
      ]}
      inTabs
    />
  );
}
