import { PlaceholderScreen } from '../../../src/features/placeholder/PlaceholderScreen';

export default function ScanFailedScreen() {
  return (
    <PlaceholderScreen
      title="Scan failed"
      designFile="ScanFailed"
      links={[
        { label: "Try again", href: "/scan/camera", replace: true },
        { label: "Enter manually", href: "/expense-form?mode=add", replace: true },
      ]}
      canGoBack
    />
  );
}
