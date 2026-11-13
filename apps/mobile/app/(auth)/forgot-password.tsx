/**
 * A4 · Forgot password (SRS 3.5.1). Not in the design handoff (AGENTS.md §13): built in the
 * style of Sign up. Supabase emails a reset link that opens /reset-password in the app.
 *
 * The result never reveals whether an account exists: any well-formed address gets the same
 * "If an account exists…" message.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, MailIcon, PageTitle, TextField } from '../../src/components';
import { GENERIC_ERROR } from '../../src/features/auth/authErrors';
import { AuthFailure, requestPasswordReset } from '../../src/features/auth/authService';
import { AuthLogo, AuthStatus, BackLink, FormError } from '../../src/features/auth/components';
import { forgotPasswordSchema } from '../../src/features/auth/schemas';
import { colors, font, spacing } from '../../src/theme';

/**
 * Supabase allows one recovery email per address per 60 s by default. The PKCE code must be
 * exchanged within flow_state_expiry_duration (default 300 s) of the request, hence the
 * "within 5 minutes" copy below.
 */
const RESEND_COOLDOWN_S = 60;

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string }>();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: typeof params.email === 'string' ? params.email : '' },
  });

  const send = async (email: string) => {
    setFormError(null);
    try {
      await requestPasswordReset(email);
      setSentTo(email);
      return true;
    } catch (error) {
      setFormError(error instanceof AuthFailure ? error.message : GENERIC_ERROR);
      return false;
    }
  };

  const onSubmit = handleSubmit(async ({ email }) => {
    await send(email);
  });

  const goToSignIn = () => router.replace('/sign-in');

  if (sentTo) {
    return (
      <CheckInbox
        email={sentTo}
        onResend={() => send(sentTo)}
        error={formError}
        onSignIn={goToSignIn}
      />
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <BackLink label="Sign in" onPress={goToSignIn} />

        <View style={styles.intro}>
          <AuthLogo size="medium" />
          <View style={styles.title}>
            <PageTitle eyebrow="Forgot your password?" title="Reset password" />
          </View>
          <AppText variant="body" color={colors.textMuted} style={styles.subtitle}>
            Enter the email you use for Lunti. We&apos;ll send you a link to choose a new password.
          </AppText>
        </View>

        <View style={styles.form}>
          <Controller
            control={control}
            name="email"
            render={({ field }) => (
              <TextField
                label="Email"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors.email?.message}
                leftIcon={<MailIcon size={18} color={colors.textFaint} />}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="send"
                onSubmitEditing={() => onSubmit()}
              />
            )}
          />

          <FormError message={formError} />

          <Button label="Send reset link" onPress={onSubmit} loading={isSubmitting} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function CheckInbox({
  email,
  onResend,
  error,
  onSignIn,
}: {
  email: string;
  onResend: () => Promise<boolean>;
  error: string | null;
  onSignIn: () => void;
}) {
  const [wait, setWait] = useState(RESEND_COOLDOWN_S);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const resend = async () => {
    setResending(true);
    setResent(false);
    const ok = await onResend();
    setResending(false);
    if (ok) {
      setResent(true);
      setWait(RESEND_COOLDOWN_S);
    }
  };

  return (
    <AuthStatus
      icon={<MailIcon size={28} color={colors.primary} />}
      eyebrow="Check your email"
      title="Reset link sent"
      actions={
        <>
          <Button label="Back to sign in" onPress={onSignIn} />
          <Button
            label={wait > 0 ? `Resend link in ${wait}s` : 'Resend link'}
            variant="secondary"
            onPress={resend}
            loading={resending}
            disabled={wait > 0}
          />
        </>
      }
    >
      <AppText variant="bodyLarge">
        If an account exists for{' '}
        <AppText variant="bodyLarge" style={styles.email}>
          {email}
        </AppText>
        , we&apos;ve sent a link to reset your password. Open it on this phone within 5 minutes.
        For your security, the link works only once.
      </AppText>
      <AppText variant="body" color={colors.textMuted}>
        Not there? Check your spam folder, or make sure you typed the email you signed up with.
        If you ask for more than one link, use the newest email.
      </AppText>
      {resent ? (
        <AppText variant="body" color={colors.primaryChipText} accessibilityLiveRegion="polite">
          We sent the link again.
        </AppText>
      ) : null}
      <FormError message={error} />
    </AuthStatus>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1 },
  intro: { paddingTop: spacing.xs, paddingHorizontal: spacing.xxl },
  title: { marginTop: spacing.lg },
  subtitle: { marginTop: 6 },
  form: { paddingTop: spacing.xxl, paddingHorizontal: spacing.xxl, gap: spacing.lg },
  email: { ...font(700), color: colors.text },
});
