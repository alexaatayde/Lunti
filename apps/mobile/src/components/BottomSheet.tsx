import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, shadows, spacing } from '../theme';
import { AppText } from './AppText';

export type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  eyebrow?: string;
  title?: string;
  children?: ReactNode;
};

/** Sheet with grabber over a scrim (TxnAddSheet.html). Tapping the scrim or Back closes it. */
export function BottomSheet({ visible, onClose, eyebrow, title, children }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const [translateY] = useState(() => new Animated.Value(400));

  useEffect(() => {
    if (visible) {
      translateY.setValue(400);
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 22,
        stiffness: 220,
      }).start();
    }
  }, [visible, translateY]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          style={styles.scrim}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { paddingBottom: 32 + insets.bottom, transform: [{ translateY }] },
          ]}
        >
          <View style={styles.grabber} />
          {eyebrow || title ? (
            <View>
              {eyebrow ? (
                <AppText variant="eyebrow" style={styles.eyebrow}>
                  {eyebrow}
                </AppText>
              ) : null}
              {title ? (
                <AppText variant="sheetTitle" accessibilityRole="header">
                  {title}
                </AppText>
              ) : null}
            </View>
          ) : null}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingTop: 10,
    paddingHorizontal: spacing.screen,
    gap: spacing.lg,
    boxShadow: shadows.sheet,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.borderInput,
  },
  eyebrow: { marginBottom: spacing.xxs },
});
