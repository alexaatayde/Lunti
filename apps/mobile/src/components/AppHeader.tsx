import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, sizes, spacing } from '../theme';
import { UserIcon } from './icons';

const mark = require('../../assets/brand/lunti-mark.png');
const wordmark = require('../../assets/brand/lunti-wordmark.png');

export type AppHeaderProps = {
  /** Opens Profile. Hide the avatar by passing `showAvatar={false}`. */
  onAvatarPress?: () => void;
  showAvatar?: boolean;
};

/** Logo lockup left, avatar right (Transactions.html header). */
export function AppHeader({ onAvatarPress, showAvatar = true }: AppHeaderProps) {
  return (
    <View style={styles.header}>
      <View
        style={styles.logo}
        accessible
        accessibilityRole="header"
        accessibilityLabel="Lunti"
      >
        <Image source={mark} style={styles.mark} contentFit="contain" />
        <Image source={wordmark} style={styles.wordmark} contentFit="contain" />
      </View>
      {showAvatar ? (
        <Pressable
          onPress={onAvatarPress}
          accessibilityRole="button"
          accessibilityLabel="Profile"
          hitSlop={4}
          style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
        >
          <UserIcon size={20} color={colors.textBody} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.screen,
    backgroundColor: colors.bg,
  },
  logo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 29, height: 30 },
  wordmark: { width: 59, height: 22, marginTop: spacing.xs },
  avatar: {
    width: sizes.avatar,
    height: sizes.avatar,
    borderRadius: sizes.avatar / 2,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderInput,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
