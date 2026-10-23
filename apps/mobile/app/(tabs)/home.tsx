import { PlaceholderScreen } from '../../src/features/placeholder/PlaceholderScreen';

export default function HomeScreen() {
  return (
    <PlaceholderScreen
      title="Home"
      designFile="Home"
      links={[
        { label: "Scan receipt", href: "/scan/camera" },
        { label: "View pantry", href: "/meals/pantry" },
        { label: "Notifications", href: "/notifications" },
        { label: "Welcome (auth flow)", href: "/welcome" },
        ...(__DEV__ ? [{ label: "Component gallery (dev)", href: "/dev/components" as const }] : []),
      ]}
      inTabs
    />
  );
}
