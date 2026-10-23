import type { ReactNode } from 'react';
import Svg from 'react-native-svg';

import { colors } from '../../theme';

export type IconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Set when the icon carries meaning on its own; decorative icons stay hidden from screen readers. */
  accessibilityLabel?: string;
};

type BaseProps = IconProps & { children: ReactNode; defaultStrokeWidth: number };

/** 24×24 stroke icon with round caps/joins (DESIGN_HANDOFF.md §1 Icons). */
export function IconBase({
  size = 24,
  color = colors.text,
  strokeWidth,
  defaultStrokeWidth,
  accessibilityLabel,
  children,
}: BaseProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth ?? defaultStrokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
    >
      {children}
    </Svg>
  );
}
