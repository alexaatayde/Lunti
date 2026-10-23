import { PlaceholderScreen } from '../../src/features/placeholder/PlaceholderScreen';

export default function MealsPantryScreen() {
  return (
    <PlaceholderScreen
      title="Pantry"
      designFile="Pantry"
      links={[{ label: "Find a recipe", href: "/meals" }]}
      canGoBack
    />
  );
}
