/** A1 · Sign in (design/screens/SignIn.html, SRS 3.5.1). */
import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
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
  AppText,
  ArrowRightIcon,
  Button,
  buttonTextColor,
  Checkbox,
  LockIcon,
  MailIcon,
  PageTitle,
  TextField,
} from '../../src/components';
import { GENERIC_ERROR } from '../../src/features/auth/authErrors';
import { AuthFailure, signIn } from '../../src/features/auth/authService';
import {
  AuthLogo,
  FormError,
  LeafShape,
  PasswordField,
  SessionEndedNotice,
  TextLinkRow,
} from '../../src/features/auth/components';
import { signInSchema } from '../../src/features/auth/schemas';
import { colors, font, sizes, spacing } from '../../src/theme';

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const passwordRef = useRef<TextInputInstance>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '', keepSignedIn: true },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      // On success the session listener updates the store and the route guard opens Home.
      await signIn(values);
    } catch (error) {
      setFormError(error instanceof AuthFailure ? error.message : GENERIC_ERROR);
    }
  });

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 36 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.hero, { paddingTop: Math.max(56, insets.top + 24) }]}>
          <LeafShape size={220} color={colors.track} style={styles.heroLeaf} />
          <AuthLogo size="large" />
          <View style={styles.heroText}>
            <PageTitle eyebrow="Good to see you again" title="Sign in" />
            <AppText variant="body" color={colors.textMuted} style={styles.subtitle}>
              Pick up where you left off with your budget, receipts and meals.
            </AppText>
          </View>
        </View>

        <View style={styles.form}>
          <SessionEndedNotice />
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
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
            )}
          />
          <Controller
            control={control}
            name="password"
            render={({ field }) => (
              <PasswordField
                ref={passwordRef}
                label="Password"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors.password?.message}
                leftIcon={<LockIcon size={18} color={colors.textFaint} />}
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={() => onSubmit()}
              />
            )}
          />

          <View style={styles.options}>
            <Controller
              control={control}
              name="keepSignedIn"
              render={({ field }) => (
                <Checkbox
                  label="Keep me signed in"
                  checked={field.value}
                  onChange={field.onChange}
                  style={styles.keepSignedIn}
                />
              )}
            />
            {/* SignIn.html: right-aligned "Forgot password?" link. */}
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/forgot-password',
                  params: { email: getValues('email').trim() },
                })
              }
              accessibilityRole="link"
              accessibilityLabel="Forgot password?"
              style={({ pressed }) => [styles.forgot, pressed && styles.pressed]}
            >
              <AppText style={styles.forgotText}>Forgot password?</AppText>
            </Pressable>
          </View>

          <FormError message={formError} />

          <Button
            label="Sign in"
            onPress={onSubmit}
            loading={isSubmitting}
            rightIcon={<ArrowRightIcon size={18} color={buttonTextColor('primary')} />}
            style={styles.submit}
          />
        </View>

        <View style={styles.footer}>
          <TextLinkRow
            text="New to Lunti?"
            linkLabel="Create an account"
            onPress={() => router.replace('/sign-up')}
          />
          <View style={styles.privacyNote}>
            <LockIcon size={12} color={colors.textFaint} strokeWidth={2} />
            <AppText variant="small" color={colors.textMuted}>
              Your data is encrypted and only visible to you.
            </AppText>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1 },
  hero: {
    overflow: 'hidden',
    backgroundColor: colors.surfaceTint,
    borderBottomWidth: 1,
    borderColor: colors.borderTint,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    paddingHorizontal: spacing.xxl,
    paddingBottom: 28,
  },
  heroLeaf: { right: -60, top: -40, opacity: 0.5 },
  heroText: { marginTop: 28 },
  subtitle: { marginTop: 6 },
  form: { paddingTop: 28, paddingHorizontal: spacing.xxl, gap: spacing.lg },
  options: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  keepSignedIn: { flexShrink: 1 },
  forgot: { minHeight: sizes.touchTarget, justifyContent: 'center', paddingLeft: spacing.xs },
  forgotText: { ...font(600), fontSize: 13, lineHeight: 18, color: colors.primaryLink },
  pressed: { opacity: 0.6 },
  submit: { marginTop: spacing.xs },
  footer: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.xxl,
    gap: spacing.xs,
  },
  privacyNote: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
