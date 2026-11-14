/**
 * Recipe photo slot (Meals.html card image). The catalog has no licensed photos yet, so every
 * recipe shows the same light placeholder: no image bundle, nothing to download. Decorative,
 * so screen readers skip it (the recipe name is read right after).
 */
import { StyleSheet, View } from 'react-native';

import { BowlIcon } from '../../components';
import { colors, radius } from '../../theme';

export function RecipePhoto({ height }: { height: number }) {
  return (
    <View
      style={[styles.tile, { height }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="recipe-photo-placeholder"
    >
      <BowlIcon size={Math.round(height / 3)} color={colors.primaryChipText} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: '100%',
    borderRadius: radius.listCard,
    backgroundColor: colors.primaryChipBg,
    borderWidth: 1,
    borderColor: colors.borderTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
