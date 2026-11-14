/**
 * Phase 8C accessibility: WCAG 2.x contrast of the color pairs the app draws text with.
 * AA = 4.5:1 for normal text, 3:1 for large text and UI component boundaries (1.4.11).
 */
import { categoryTones, colors } from '../../src/theme';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Blends "rgba(255,255,255,a)" over a solid background. */
function over(rgba: string, bg: string): string {
  const [r, g, b, a] = rgba.match(/[\d.]+/g)!.map(Number);
  const mix = [1, 3, 5].map((i, k) =>
    Math.round([r, g, b][k] * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a)),
  );
  return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT: [string, string, string][] = [
  ['primary button label', colors.textOnPrimary, colors.primaryAction],
  ['danger button label', colors.textOnPrimary, colors.dangerText],
  ['green link on page', colors.primaryLink, colors.bg],
  ['green link on card', colors.primaryLink, colors.surface],
  ['section eyebrow on page', colors.primaryEyebrow, colors.bg],
  ['section eyebrow on card', colors.primaryEyebrow, colors.surface],
  ['success badge', colors.primaryChipTextAlt, colors.primaryChipBg],
  ['chip text', colors.primaryChipText, colors.primaryChipBg],
  ['placeholder / muted on card', colors.textMuted, colors.surface],
  ['muted on page', colors.textMuted, colors.bg],
  ['muted on tinted surface', colors.textMuted, colors.surfaceTint],
  ['muted on grey fill', colors.textMuted, colors.surfaceMuted],
  ['body text', colors.textBody, colors.surface],
  ['warning text', colors.warnStrong, colors.warnBg],
  ['offline strip', colors.warnStrong, colors.warnBg],
  ['error text', colors.dangerText, colors.dangerBg],
  ['inactive nav label', colors.navInactive, colors.surface],
  ['Overall budget meta', over(colors.onPrimaryMuted, colors.primaryAction), colors.primaryAction],
  ['dining tile', categoryTones.dining.fg, categoryTones.dining.bg],
];

it.each(TEXT)('%s meets WCAG AA for normal text (4.5:1)', (_name, fg, bg) => {
  expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
});

it.each([
  ['unchecked checkbox / off switch', colors.controlBorder, colors.surface],
  ['on switch / checked box', colors.primary, colors.surface],
])('%s meets 3:1 for UI components', (_name, fg, bg) => {
  expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3);
});

it('keeps the green identity: the action green is the brand hue, a step darker', () => {
  const hue = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  expect(Math.abs(hue(colors.primaryAction) - hue(colors.primary))).toBeLessThan(5);
  expect(luminance(colors.primaryAction)).toBeLessThan(luminance(colors.primary));
});
