import { StyleSheet, View } from 'react-native';

import {
  BagIcon,
  BoltIcon,
  BusIcon,
  CupIcon,
  HouseIcon,
  MoreIcon,
  type IconProps,
} from '../../components';
import { categoryTones, radius, sizes, type CategoryToneKey } from '../../theme';

const icons: Record<CategoryToneKey, (props: IconProps) => React.JSX.Element> = {
  groceries: BagIcon,
  dining: CupIcon,
  transport: BusIcon,
  utilities: BoltIcon,
  household: HouseIcon,
  others: MoreIcon,
};

/** Maps the API's category `icon` to a tone; custom categories look like "Others". */
export function toneKey(icon: string | null | undefined): CategoryToneKey {
  return icon && icon in categoryTones ? (icon as CategoryToneKey) : 'others';
}

export function categoryColor(icon: string | null | undefined): string {
  return categoryTones[toneKey(icon)].fg;
}

export type CategoryIconProps = {
  icon: string | null | undefined;
  /** Tile size: 40 (rows, default), 52 (detail header). */
  size?: number;
};

/** Colored icon tile for a category (Transactions.html, TxnCategory.html). Decorative. */
export function CategoryIcon({ icon, size = sizes.listIconTile }: CategoryIconProps) {
  const key = toneKey(icon);
  const Glyph = icons[key];
  const tone = categoryTones[key];
  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: size > 44 ? radius.iconTileLarge : radius.iconTile,
          backgroundColor: tone.bg,
        },
      ]}
    >
      <Glyph size={Math.round(size * 0.48)} color={tone.fg} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
