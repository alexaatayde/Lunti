import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, font, sizes, spacing } from '../theme';
import { AppText } from './AppText';
import { BellIcon, UserIcon } from './icons';

const mark = require('../../assets/brand/lunti-mark.png');
const wordmark = require('../../assets/brand/lunti-wordmark.png');

export type AppHeaderProps = {
  /** Opens Profile. Hide the avatar by passing `showAvatar={false}`. */
  onAvatarPress?: () => void;
  showAvatar?: boolean;
  /** Shows a bell that opens Notifications (not in the design yet; AGENTS.md §13). */
  onBellPress?: () => void;
  unreadCount?: number;
};

/** Logo lockup left, avatar right (Transactions.html header). */
export function AppHeader({
  onAvatarPress,
  showAvatar = true,
  onBellPress,
  unreadCount = 0,
}: AppHeaderProps) {
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
      <View style={styles.actions}>
        {onBellPress ? (
          <Pressable
            onPress={onBellPress}
            accessibilityRole="button"
            accessibilityLabel={
              unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
            }
            hitSlop={4}
            style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
          >
            <BellIcon size={20} color={colors.textBody} />
            {unreadCount > 0 ? (
              <View style={styles.dot}>
                <AppText style={styles.dotText}>{unreadCount > 9 ? '9+' : unreadCount}</AppText>
              </View>
            ) : null}
          </Pressable>
        ) : null}
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
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.dangerText,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotText: { ...font(700), fontSize: 11, lineHeight: 14, color: colors.textOnPrimary },
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
