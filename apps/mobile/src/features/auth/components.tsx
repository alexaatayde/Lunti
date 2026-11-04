/** Small pieces shared by the Welcome, Sign in and Sign up screens. */
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import {
  AlertCircleIcon,
  AppText,
  EyeIcon,
  EyeOffIcon,
  TextField,
  type TextFieldProps,
} from '../../components';
import { colors, font, radius, sizes, spacing } from '../../theme';
import { passwordStrength } from './schemas';

const mark = require('../../../assets/brand/lunti-mark.png');
const wordmark = require('../../../assets/brand/lunti-wordmark.png');

/** Logo lockup. Sizes per screen: Welcome 29×30, Sign up 34×36, Sign in 40×42 (mark). */
export function AuthLogo({ size }: { size: 'small' | 'medium' | 'large' }) {
  const s = logoSizes[size];
  return (
    <View
      style={[styles.logo, { gap: s.gap }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Lunti"
    >
      <Image source={mark} style={s.mark} contentFit="contain" />
      <Image source={wordmark} style={[s.wordmark, { marginTop: s.offset }]} contentFit="contain" />
    </View>
  );
}

const logoSizes = {
  small: {
    mark: { width: 29, height: 30 },
    wordmark: { width: 59, height: 22 },
    offset: 4,
    gap: 8,
  },
  medium: {
    mark: { width: 34, height: 36 },
    wordmark: { width: 67, height: 25 },
    offset: 5,
    gap: 8,
  },
  large: {
    mark: { width: 40, height: 42 },
    wordmark: { width: 80, height: 30 },
    offset: 6,
    gap: 10,
  },
};

/** Decorative leaf shape behind hero sections (SignIn.html, Landing.html). */
export function LeafShape({
  size,
  color,
  style,
}: {
  size: number;
  color: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[styles.leaf, style]}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
          d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"
          fill={color}
        />
      </Svg>
    </View>
  );
}

/** Password input with a show/hide toggle (SignIn.html, SignUp.html). */
export function PasswordField(props: Omit<TextFieldProps, 'right' | 'secureTextEntry'>) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      secureTextEntry={!visible}
      autoCapitalize="none"
      autoCorrect={false}
      right={
        <Pressable
          onPress={() => setVisible((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          style={({ pressed }) => [styles.eye, pressed && styles.pressed]}
        >
          {visible ? (
            <EyeOffIcon size={18} color={colors.textMuted} />
          ) : (
            <EyeIcon size={18} color={colors.textMuted} />
          )}
        </Pressable>
      }
    />
  );
}

const strengthColor = [
  '',
  colors.dangerText,
  colors.warnText,
  colors.primaryChipText,
  colors.primaryChipText,
];
const segmentColor = [
  '',
  colors.dangerText,
  colors.warnText,
  colors.primaryBright,
  colors.primaryBright,
];

/** 4-segment meter + label under the password field (SignUp.html). Label carries the meaning. */
export function PasswordStrengthMeter({ password }: { password: string }) {
  const { score, label } = passwordStrength(password);
  return (
    <View style={styles.strength} testID="password-strength">
      <View
        style={styles.segments}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {[1, 2, 3, 4].map((i) => (
          <View
            key={i}
            style={[
              styles.segment,
              { backgroundColor: i <= score ? segmentColor[score] : colors.borderInput },
            ]}
          />
        ))}
      </View>
      <AppText variant="meta" accessibilityLiveRegion="polite">
        {label ? (
          <AppText variant="meta" style={[font(700), { color: strengthColor[score] }]}>
            {`${label} password · `}
          </AppText>
        ) : null}
        at least 8 characters with a number
      </AppText>
    </View>
  );
}

/** Form-level error (wrong password, offline…). Icon + text, so not color alone. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.formError} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <AlertCircleIcon size={18} color={colors.dangerText} />
      <AppText variant="body" color={colors.dangerText} style={styles.formErrorText}>
        {message}
      </AppText>
    </View>
  );
}

/** "New to Lunti? Create an account" — plain text followed by a 44 px tall link. */
export function TextLinkRow({
  text,
  linkLabel,
  onPress,
}: {
  text: string;
  linkLabel: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.linkRow}>
      <AppText variant="body" color={colors.textMuted}>
        {text}
      </AppText>
      <Pressable
        onPress={onPress}
        accessibilityRole="link"
        accessibilityLabel={linkLabel}
        style={({ pressed }) => [styles.link, pressed && styles.pressed]}
      >
        <AppText variant="body" style={styles.linkText}>
          {linkLabel}
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { flexDirection: 'row', alignItems: 'center' },
  leaf: { position: 'absolute' },
  eye: {
    width: 40,
    height: 40,
    borderRadius: radius.iconTile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  strength: { gap: 6, marginTop: spacing.xxs },
  segments: { flexDirection: 'row', gap: spacing.xs },
  segment: { flex: 1, height: 4, borderRadius: radius.pill },
  formError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.iconTile,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  formErrorText: { flex: 1, fontSize: 13, lineHeight: 18 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  link: { minHeight: sizes.touchTarget, justifyContent: 'center', paddingHorizontal: spacing.xs },
  linkText: { ...font(700), color: colors.primaryLink },
});
