import { PlaceholderScreen } from '../../../src/features/placeholder/PlaceholderScreen';

export default function ScanReviewScreen() {
  return (
    <PlaceholderScreen
      title="Review receipt"
      designFile="ScanReview"
      links={[{ label: "Save & add to pantry", href: "/transactions" }]}
      canGoBack
    />
  );
}
