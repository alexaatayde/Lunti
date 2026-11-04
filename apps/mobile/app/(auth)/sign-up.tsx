/** A2 · Sign up with RA 10173 consent (design/screens/SignUp.html, SRS 3.5.1). */
import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextInputInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AlertCircleIcon,
  AppText,
  Button,
  CheckIcon,
  Checkbox,
  ChevronLeftIcon,
  MailIcon,
  PageTitle,
  TextField,
} from '../../src/components';
import { GENERIC_ERROR } from '../../src/features/auth/authErrors';
import { AuthFailure, signUp } from '../../src/features/auth/authService';
import {
  AuthLogo,
  FormError,
  PasswordField,
  PasswordStrengthMeter,
  TextLinkRow,
} from '../../src/features/auth/components';
import { signUpSchema } from '../../src/features/auth/schemas';
import { colors, font, radius, sizes, spacing } from '../../src/theme';

const FIELD_HEIGHT = 50; // SignUp.html uses 50 px fields (Sign in uses 52).

export default function SignUpScreen() {
  const insets = useSafeAreaInsets();
  const emailRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);
  const confirmRef = useRef<TextInputInstance>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmEmailFor, setConfirmEmailFor] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      fullName: '',
      email: '',
      password: '',
      confirmPassword: '',
      acceptTerms: false,
      dataConsent: false,
    },
  });
  const [password, confirmPassword] = useWatch({ control, name: ['password', 'confirmPassword'] });
  const passwordsMatch = !!confirmPassword && confirmPassword === password;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await signUp(values);
      // signedIn: the route guard opens Home. confirmEmail: show the "check your email" step.
      if (result.status === 'confirmEmail') setConfirmEmailFor(result.email);
    } catch (error) {
      setFormError(error instanceof AuthFailure ? error.message : GENERIC_ERROR);
    }
  });

  const goToSignIn = () => router.replace('/sign-in');

  if (confirmEmailFor) {
    return <CheckEmail email={confirmEmailFor} onSignIn={goToSignIn} />;
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
        <View style={styles.header}>
          <Pressable
            onPress={goToSignIn}
            accessibilityRole="link"
            accessibilityLabel="Back to sign in"
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <ChevronLeftIcon size={20} color={colors.primaryLink} />
            <AppText style={styles.backText}>Sign in</AppText>
          </Pressable>
        </View>

        <View style={styles.intro}>
          <AuthLogo size="medium" />
          <View style={styles.title}>
            <PageTitle eyebrow="Start growing your savings" title="Create your account" />
          </View>
          <AppText variant="body" color={colors.textMuted} style={styles.subtitle}>
            Track spending, scan receipts and plan meals from what you already have.
          </AppText>
        </View>

        <View style={styles.form}>
          <Controller
            control={control}
            name="fullName"
            render={({ field }) => (
              <TextField
                label="Full name"
                height={FIELD_HEIGHT}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors.fullName?.message}
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => emailRef.current?.focus()}
              />
            )}
          />
          <Controller
            control={control}
            name="email"
            render={({ field }) => (
              <TextField
                ref={emailRef}
                label="Email"
                height={FIELD_HEIGHT}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors.email?.message}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
            )}
          />
          <View style={styles.passwordGroup}>
            <Controller
              control={control}
              name="password"
              render={({ field }) => (
                <PasswordField
                  ref={passwordRef}
                  label="Password"
                  height={FIELD_HEIGHT}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={errors.password?.message}
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
              <TextField
                ref={confirmRef}
                label="Confirm password"
                height={FIELD_HEIGHT}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors.confirmPassword?.message}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="done"
                right={
                  passwordsMatch ? (
                    <View style={styles.matchIcon}>
                      <CheckIcon
                        size={18}
                        color={colors.primary}
                        accessibilityLabel="Passwords match"
                      />
                    </View>
                  ) : undefined
                }
              />
            )}
          />

          <View style={styles.consents}>
            <Controller
              control={control}
              name="acceptTerms"
              render={({ field }) => (
                <Checkbox
                  alignTop
                  checked={field.value}
                  onChange={field.onChange}
                  invalid={!!errors.acceptTerms}
                  accessibilityLabel="I agree to the Terms of Use and Privacy Notice."
                  label={
                    <AppText style={styles.consentText}>
                      I agree to the <AppText style={styles.consentStrong}>Terms of Use</AppText>{' '}
                      and <AppText style={styles.consentStrong}>Privacy Notice</AppText>.
                    </AppText>
                  }
                />
              )}
            />
            <Controller
              control={control}
              name="dataConsent"
              render={({ field }) => (
                <Checkbox
                  alignTop
                  checked={field.value}
                  onChange={field.onChange}
                  invalid={!!errors.dataConsent}
                  label={
                    <AppText style={styles.consentText}>
                      I consent to Lunti processing my receipts and spending data to give me budgets
                      and suggestions, as required by the Data Privacy Act of 2012.
                    </AppText>
                  }
                  accessibilityLabel="I consent to Lunti processing my receipts and spending data to give me budgets and suggestions, as required by the Data Privacy Act of 2012."
                />
              )}
            />
            {errors.acceptTerms || errors.dataConsent ? (
              <View style={styles.consentError} accessibilityLiveRegion="polite">
                <AlertCircleIcon size={14} color={colors.dangerText} strokeWidth={2.2} />
                <AppText variant="meta" color={colors.dangerText} style={styles.flex}>
                  {errors.acceptTerms?.message ?? errors.dataConsent?.message}
                </AppText>
              </View>
            ) : null}
          </View>

          <FormError message={formError} />

          <Button
            label="Create account"
            onPress={onSubmit}
            loading={isSubmitting}
            style={styles.submit}
          />
        </View>

        <View style={styles.footer}>
          <TextLinkRow text="Already have an account?" linkLabel="Sign in" onPress={goToSignIn} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * Shown when the Supabase project requires email confirmation, so sign-up returns no session.
 * Not in the design handoff; built in the existing style (AGENTS.md §13).
 */
function CheckEmail({ email, onSignIn }: { email: string; onSignIn: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.root,
        styles.checkEmail,
        { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 },
      ]}
    >
      <View style={styles.checkEmailBody}>
        <View style={styles.mailTile}>
          <MailIcon size={28} color={colors.primary} />
        </View>
        <PageTitle eyebrow="One more step" title="Check your email" />
        <AppText variant="bodyLarge">
          We sent a confirmation link to{' '}
          <AppText variant="bodyLarge" style={styles.email}>
            {email}
          </AppText>
          . Open it to activate your account, then sign in.
        </AppText>
      </View>
      <Button label="Go to sign in" onPress={onSignIn} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1 },
  flex: { flex: 1 },
  header: { paddingHorizontal: spacing.md, flexDirection: 'row' },
  back: {
    minHeight: sizes.touchTarget,
    paddingLeft: spacing.xs,
    paddingRight: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  backText: { ...font(600), fontSize: 15, lineHeight: 20, color: colors.primaryLink },
  pressed: { opacity: 0.6 },
  intro: { paddingTop: spacing.xs, paddingHorizontal: spacing.xxl },
  title: { marginTop: spacing.lg },
  subtitle: { marginTop: 6 },
  form: { paddingTop: spacing.xxl, paddingHorizontal: spacing.xxl, gap: 14 },
  passwordGroup: { gap: spacing.xs },
  matchIcon: { width: 40, alignItems: 'center' },
  consents: {
    gap: 10,
    padding: 14,
    borderRadius: 18,
    backgroundColor: colors.surfaceTint,
    borderWidth: 1,
    borderColor: colors.borderTint,
    marginTop: spacing.xxs,
  },
  // Terms/Privacy are emphasized but not links yet: the documents don't exist (see PR notes).
  consentText: { ...font(400), fontSize: 13, lineHeight: 18, color: colors.textStrong },
  consentStrong: { ...font(700), color: colors.primaryChipText },
  consentError: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  submit: { marginTop: spacing.xs },
  footer: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.xxl,
  },
  checkEmail: { paddingHorizontal: spacing.xxl, justifyContent: 'space-between' },
  checkEmailBody: { gap: spacing.lg },
  mailTile: {
    width: 56,
    height: 56,
    borderRadius: radius.iconTileLarge,
    backgroundColor: colors.primaryChipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  email: { ...font(700), color: colors.text },
});
