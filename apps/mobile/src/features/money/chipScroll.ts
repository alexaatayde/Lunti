/** Horizontal scrolling that keeps the selected filter chip in view (Transactions chip row). */

export type ChipLayout = { x: number; width: number };
export type Viewport = { offset: number; width: number };

/**
 * The scroll offset that brings `chip` fully into view with `margin` to spare, or null when it
 * is already visible (so a chip the user just tapped never makes the row jump).
 */
export function revealOffset(chip: ChipLayout, viewport: Viewport, margin = 0): number | null {
  if (viewport.width <= 0) return null;
  const left = chip.x - margin;
  const right = chip.x + chip.width + margin;
  if (left < viewport.offset) return Math.max(0, left);
  if (right > viewport.offset + viewport.width) return right - viewport.width;
  return null;
}
