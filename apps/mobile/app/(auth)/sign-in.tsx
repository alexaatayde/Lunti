import { PlaceholderScreen } from '../../src/features/placeholder/PlaceholderScreen';

export default function SignInScreen() {
  return (
    <PlaceholderScreen
      title="Sign in"
      designFile="SignIn"
      links={[
        { label: "Sign in", href: "/home", replace: true },
        { label: "Create an account", href: "/sign-up" },
      ]}
      canGoBack
    />
  );
}
