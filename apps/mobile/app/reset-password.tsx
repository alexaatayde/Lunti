/**
 * A5 · Choose a new password (SRS 3.5.1). Opened by the link in the password-reset email
 * (lunti://reset-password?code=…). Not in the design handoff (AGENTS.md §13): built in the
 * style of Sign up.
 *
 * Flow: the one-time code becomes a temporary, memory-only session (the app's signed-in
 * screens stay closed) → the user saves a new password → every session for the account is
 * signed out → the user signs in with the new password.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  View,
  type TextInputInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AlertTriangleIcon,
  AppText,
  Button,
  CheckIcon,
  LockIcon,
  PageTitle,
} from '../src/components';
import { GENERIC_ERROR } from '../src/features/auth/authErrors';
import {
  AuthFailure,
  endRecovery,
  RecoveryLinkFailure,
  RecoverySessionEnded,
  setNewPassword,
  startPasswordRecovery,
  type RecoveryFailure,
} from '../src/features/auth/authService';
import {
  AuthLogo,
  AuthStatus,
  BackLink,
  FormError,
  PasswordField,
  PasswordStrengthMeter,
} from '../src/features/auth/components';
import { fragmentParams, parseRecoveryLink } from '../src/features/auth/recoveryLink';
import { resetPasswordSchema } from '../src/features/auth/schemas';
import { useHardwareBack } from '../src/features/scan/flow';
import { selectSignedIn, useSessionStore } from '../src/stores/session';
import { colors, spacing } from '../src/theme';

type Step =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'done' }
  | { kind: 'failed'; reason: RecoveryFailure | 'missing' };

export default function ResetPasswordScreen() {
  const params = useLocalSearchParams();
  const linkingUrl = Linking.useLinkingURL();
  const recovering = useSessionStore((s) => s.recovering);
  const link = parseRecoveryLink(params, fragmentParams(linkingUrl));
  const [step, setStep] = useState<Step>(() =>
    link.kind === 'code'
      ? { kind: 'checking' }
      : link.kind === 'error'
        ? { kind: 'failed', reason: 'expired' }
        : recovering
          ? { kind: 'ready' }
          : { kind: 'failed', reason: 'missing' },
  );

  // A code works once: never send the same one twice (re-renders, Strict Mode effects).
  const usedCode = useRef<string | null>(null);
  const code = link.kind === 'code' ? link.code : null;
  useEffect(() => {
    if (!code || usedCode.current === code) return;
    usedCode.current = code;
    // Drop the code from the route so it doesn't linger in navigation state.
    router.setParams({ code: undefined });
    setStep({ kind: 'checking' });
    startPasswordRecovery(code).then(
      () => setStep({ kind: 'ready' }),
      (error) =>
        setStep({
          kind: 'failed',
          reason: error instanceof RecoveryLinkFailure ? error.reason : 'expired',
        }),
    );
  }, [code]);

  const requestNewLink = useCallback(() => leave('/forgot-password'), []);
  const cancel = useCallback(() => leave('/sign-in'), []);

  // Android back leaves the reset the same way Cancel does (never keeps the reset session).
  useHardwareBack(step.kind === 'ready' ? cancel : null);

  switch (step.kind) {
    case 'checking':
      return <Checking />;
    case 'ready':
      return (
        <NewPasswordForm
          onSaved={() => setStep({ kind: 'done' })}
          onSessionEnded={() => setStep({ kind: 'failed', reason: 'expired' })}
          onCancel={cancel}
        />
      );
    case 'done':
      return (
        <AuthStatus
          icon={<CheckIcon size={28} color={colors.primary} />}
          eyebrow="All set"
          title="Password updated"
          actions={<Button label="Sign in" onPress={() => router.replace('/sign-in')} />}
        >
          <AppText variant="bodyLarge">
            Sign in with your new password. For your security, Lunti signed you out on your other
            devices too.
          </AppText>
        </AuthStatus>
      );
    case 'failed':
      return (
        <LinkProblem reason={step.reason} onRequestNew={requestNewLink} onSignIn={cancel} />
      );
  }
}

/**
 * Ends the reset session, if there is one, and moves on. Someone already signed in normally
 * (who opened an old link) stays signed in and goes Home instead.
 */
async function leave(to: '/sign-in' | '/forgot-password') {
  if (useSessionStore.getState().recovering) await endRecovery();
  router.replace(selectSignedIn(useSessionStore.getState()) ? '/home' : to);
}

function Checking() {
  return (
    <View style={[styles.root, styles.center]} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.primary} size="large" />
      <AppText variant="body" color={colors.textMuted}>
        Checking your reset link…
      </AppText>
    </View>
  );
}

const PROBLEMS: Record<RecoveryFailure | 'missing', { title: string; text: string }> = {
  expired: {
    title: 'This link has expired',
    text: 'Reset links work only once, only the newest one works, and they expire 5 minutes after you ask. Request a new link to choose a new password.',
  },
  otherDevice: {
    title: 'Open the link on this phone',
    text: 'For your security, a reset link only works on the phone where you asked for it. Request a new link here, then open the email on this phone.',
  },
  network: {
    title: "We couldn't check your link",
    text: "Can't reach Lunti right now, so the link couldn't be used. Check your connection, then request a new link.",
  },
  missing: {
    title: 'Open the link from your email',
    text: 'To choose a new password, open the reset link we emailed you, or request a new one.',
  },
};

function LinkProblem({
  reason,
  onRequestNew,
  onSignIn,
}: {
  reason: RecoveryFailure | 'missing';
  onRequestNew: () => void;
  onSignIn: () => void;
}) {
  const { title, text } = PROBLEMS[reason];
  return (
    <AuthStatus
      icon={<AlertTriangleIcon size={28} color={colors.warnText} />}
      tone="warn"
      eyebrow="Reset password"
      title={title}
      actions={
        <>
          <Button label="Request a new link" onPress={onRequestNew} />
          <Button label="Back to sign in" variant="secondary" onPress={onSignIn} />
        </>
      }
    >
      <AppText variant="bodyLarge">{text}</AppText>
    </AuthStatus>
  );
}

function NewPasswordForm({
  onSaved,
  onSessionEnded,
  onCancel,
}: {
  onSaved: () => void;
  onSessionEnded: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const confirmRef = useRef<TextInputInstance>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });
  const password = useWatch({ control, name: 'password' });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await setNewPassword(values.password);
      onSaved();
    } catch (error) {
      if (error instanceof RecoverySessionEnded) {
        await endRecovery();
        onSessionEnded();
        return;
      }
      setFormError(error instanceof AuthFailure ? error.message : GENERIC_ERROR);
    }
  });

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <BackLink label="Cancel" onPress={onCancel} />

        <View style={styles.intro}>
          <AuthLogo size="medium" />
          <View style={styles.title}>
            <PageTitle eyebrow="Reset password" title="Choose a new password" />
          </View>
          <AppText variant="body" color={colors.textMuted} style={styles.subtitle}>
            You&apos;ll use it to sign in to Lunti from now on.
          </AppText>
        </View>

        <View style={styles.form}>
          <View style={styles.passwordGroup}>
            <Controller
              control={control}
              name="password"
              render={({ field }) => (
                <PasswordField
                  label="New password"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={errors.password?.message}
                  leftIcon={<LockIcon size={18} color={colors.textFaint} />}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => confirmRef.current?.focus()}
                />
              )}
            />
            <PasswordStrengthMeter password={password} />
          </View>
          <Controller
            control={control}
            name="confirmPassword"
            render={({ field }) => (
              <PasswordField
                ref={confirmRef}
                label="Confirm new password"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors.confirmPassword?.message}
                leftIcon={<LockIcon size={18} color={colors.textFaint} />}
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="go"
                onSubmitEditing={() => onSubmit()}
              />
            )}
          />

          <FormError message={formError} />

          <Button label="Save new password" onPress={onSubmit} loading={isSubmitting} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  scroll: { flexGrow: 1 },
  intro: { paddingTop: spacing.xs, paddingHorizontal: spacing.xxl },
  title: { marginTop: spacing.lg },
  subtitle: { marginTop: 6 },
  form: { paddingTop: spacing.xxl, paddingHorizontal: spacing.xxl, gap: 14 },
  passwordGroup: { gap: spacing.xs },
});
