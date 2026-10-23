/**
 * Bottom-nav icons, paths copied from design/screens/NavBar.html.
 * Active: navActive stroke + navLeaf leaf fill. Inactive: navInactive stroke, no fill.
 */
import { Path, Rect } from 'react-native-svg';

import { colors } from '../../theme';
import { IconBase } from './Icon';

export type NavIconProps = { active?: boolean; size?: number };

const NAV_STROKE = 1.75;

function tone(active?: boolean) {
  return {
    color: active ? colors.navActive : colors.navInactive,
    leaf: active ? colors.navLeaf : 'none',
  };
}

export function AnalyticsIcon({ active, size }: NavIconProps) {
  const { color, leaf } = tone(active);
  return (
    <IconBase size={size} color={color} defaultStrokeWidth={NAV_STROKE}>
      <Path d="M3.5 20.5h17" />
      <Rect x={4.5} y={14} width={3.2} height={6.5} rx={1} />
      <Rect x={10.4} y={10.5} width={3.2} height={10} rx={1} />
      <Path d="M18.5 20.5v-8" />
      <Path d="M18.5 14c-2.3 0-3.5-1.4-3.5-3.4 2.1 0 3.5 1.2 3.5 3.4Z" fill={leaf} />
      <Path d="M18.5 12.3c0-2.4 1.3-3.8 3.3-3.8 0 2.2-1.3 3.8-3.3 3.8Z" fill={leaf} />
    </IconBase>
  );
}

/** Budget has no leaves, so `active` only changes the stroke color. */
export function BudgetIcon({ active, size }: NavIconProps) {
  const { color } = tone(active);
  return (
    <IconBase size={size} color={color} defaultStrokeWidth={NAV_STROKE}>
      <Rect x={3.5} y={6.5} width={17} height={13.5} rx={2.5} />
      <Path d="M6 6.5 15.3 3.7a1.3 1.3 0 0 1 1.7 1.2v1.6" />
      <Path d="M20.5 10.5h-3.8a2.5 2.5 0 0 0 0 5h3.8" />
    </IconBase>
  );
}

export function HomeIcon({ active, size }: NavIconProps) {
  const { color, leaf } = tone(active);
  return (
    <IconBase size={size} color={color} defaultStrokeWidth={NAV_STROKE}>
      <Path d="M4 10.2 12 3.6l8 6.6v9.3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
      <Path d="M12 20.5v-4.7" />
      <Path d="M12 17c-2.4 0-3.8-1.4-3.8-3.5 2.3 0 3.8 1.3 3.8 3.5Z" fill={leaf} />
      <Path d="M12 15.6c0-2.4 1.4-3.8 3.6-3.8 0 2.3-1.4 3.8-3.6 3.8Z" fill={leaf} />
    </IconBase>
  );
}

export function MealsIcon({ active, size }: NavIconProps) {
  const { color, leaf } = tone(active);
  return (
    <IconBase size={size} color={color} defaultStrokeWidth={NAV_STROKE}>
      <Path d="M3.5 12.5h17a8.5 7 0 0 1-17 0Z" />
      <Path d="M9.5 21h5" />
      <Path d="M12 12.5c0-3.6 2.2-6.1 6.3-6.6 0 3.6-2.2 6.1-6.3 6.6Z" fill={leaf} />
      <Path d="M11 12.5C10.2 10 8.3 8.8 5.8 8.8c.4 2.2 2.1 3.7 5.2 3.7Z" fill={leaf} />
      <Path d="M12 12.5 15.6 8.7" />
    </IconBase>
  );
}

/** Transactions has no leaves, so `active` only changes the stroke color. */
export function TransactionsIcon({ active, size }: NavIconProps) {
  const { color } = tone(active);
  return (
    <IconBase size={size} color={color} defaultStrokeWidth={NAV_STROKE}>
      <Path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3Z" />
      <Path d="M9 8h6M9 11.5h4.5M9 15h3" />
    </IconBase>
  );
}
