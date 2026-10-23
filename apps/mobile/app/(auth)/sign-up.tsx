import { PlaceholderScreen } from '../../src/features/placeholder/PlaceholderScreen';

export default function SignUpScreen() {
  return (
    <PlaceholderScreen
      title="Sign up"
      designFile="SignUp"
      links={[
        { label: "Create account", href: "/home", replace: true },
        { label: "Sign in instead", href: "/sign-in" },
      ]}
      canGoBack
    />
  );
}
