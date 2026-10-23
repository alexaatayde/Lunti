import { PlaceholderScreen } from '../../../src/features/placeholder/PlaceholderScreen';

export default function ScanCameraScreen() {
  return (
    <PlaceholderScreen
      title="Scan receipt"
      designFile="ScanCamera"
      links={[
        { label: "Capture (go to review)", href: "/scan/review" },
        { label: "Simulate OCR failure", href: "/scan/failed" },
      ]}
      canGoBack
    />
  );
}
