import { PlaceholderScreen } from '../../src/features/placeholder/PlaceholderScreen';

export default function WelcomeScreen() {
  return (
    <PlaceholderScreen
      title="Welcome"
      designFile="Landing"
      links={[
        { label: "Get started", href: "/sign-up" },
        { label: "I already have an account", href: "/sign-in" },
      ]}
    />
  );
}
