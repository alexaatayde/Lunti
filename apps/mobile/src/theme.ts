/**
 * Lunti design tokens. Source: design/DESIGN_HANDOFF.md §1 (values checked against design/screens/*.html).
 * Components must use these tokens only — no hard-coded colors, sizes or fonts.
 */
import { Platform, type TextStyle } from 'react-native';

export const colors = {
  // Surfaces
  bg: '#FBFBF8',
  surface: '#FFFFFF',
  surfaceTint: '#F4F7EE',
  borderTint: '#E3EBD9',
  border: '#F3F4F6',
  borderInput: '#E5E7EB',
  /** Not in §1: grey fill used by the "Cancel" / "Keep it" buttons, avatar and neutral icon tiles. */
  surfaceMuted: '#F3F4F6',
  /** Not in §1: summary row inside the delete dialog. */
  surfaceSubtle: '#F9FAFB',

  // Text
  text: '#111827',
  textStrong: '#374151',
  textBody: '#4B5563',
  textMuted: '#6B7280',
  textFaint: '#9CA3AF',
  textOnPrimary: '#FFFFFF',

  // Brand
  primary: '#539E2F',
  primaryBright: '#5CA833',
  primaryLink: '#4F962D',
  primaryEyebrow: '#5A9C39',
  primaryDeep: '#1F4812',
  primaryChipBg: '#EDF6E8',
  primaryChipText: '#3E7525',
  primaryChipTextAlt: '#4D972B',
  track: '#DFE8D4',

  // Bottom navigation
  navActiveBg: '#E3F2E8',
  navActive: '#1F7A4D',
  navLeaf: '#A7D7B5',
  navInactive: '#5F6F66',

  // Status
  warnBg: '#FEF3C7',
  warnText: '#B45309',
  warnStrong: '#92400E',
  /** Not in §1: border of a near-limit budget card (Budget.html, amber-200). */
  warnBorder: '#FDE68A',
  dangerText: '#B91C1C',
  dangerBg: '#FEF2F2',
  dangerBorder: '#FECACA',

  // On a primary-colored card (Budget.html "Overall"), rendered with the current tokens.
  onPrimaryMuted: 'rgba(255,255,255,0.78)',
  onPrimaryTrack: 'rgba(255,255,255,0.25)',
  onPrimaryFill: 'rgba(255,255,255,0.72)',
  onPrimaryChip: 'rgba(255,255,255,0.18)',

  // Overlays
  scrim: 'rgba(17,24,39,0.45)',
  toastBg: '#111827',
  toastAccent: '#86D9A6',
  toastText: '#FFFFFF',

  // Welcome / auth illustrations (not in §1; values from Landing.html)
  /** Large leaf shape behind the Welcome hero. */
  leafTint: '#E6EFDC',
  /** Phone frame around the mini Home screen on Welcome. */
  deviceFrame: '#1F2A22',
  /** Border of the floating callout cards on Welcome. */
  calloutBorder: '#EEF1EA',

  // Logo (use the PNGs in assets/brand; listed for completeness)
  logoText: '#37443B',
  logoLeaf: '#70A44F',
} as const;

export type ColorToken = keyof typeof colors;

/**
 * Category icon tiles (TxnCategory.html, Transactions.html). Keyed by the category's `icon`
 * from the API; unknown or custom categories use `others`.
 */
export const categoryTones = {
  groceries: { bg: '#EDF6E8', fg: '#4D972B' },
  dining: { bg: '#FFF7E6', fg: '#B45309' },
  transport: { bg: '#EEF2FF', fg: '#4F46E5' },
  utilities: { bg: '#FEF9C3', fg: '#A16207' },
  household: { bg: '#FDF2F8', fg: '#BE185D' },
  others: { bg: '#F3F4F6', fg: '#4B5563' },
} as const;

export type CategoryToneKey = keyof typeof categoryTones;

/** Inter on Android (and web), SF Pro (system font) on iOS — DESIGN_HANDOFF.md §1 Typography. */
export type FontWeight = 400 | 500 | 600 | 700 | 800 | 900;

const interFamily: Record<FontWeight, string> = {
  400: 'Inter_400Regular',
  500: 'Inter_500Medium',
  600: 'Inter_600SemiBold',
  700: 'Inter_700Bold',
  800: 'Inter_800ExtraBold',
  900: 'Inter_900Black',
};

/** Font style for a weight. Android needs one family per weight; iOS uses the system font. */
export function font(weight: FontWeight): TextStyle {
  if (Platform.OS === 'ios') {
    return { fontWeight: String(weight) as TextStyle['fontWeight'] };
  }
  return { fontFamily: interFamily[weight] };
}

/** Letter-spacing in the design is in em; React Native needs points. */
const em = (value: number, fontSize: number) => value * fontSize;

export const typography = {
  eyebrow: {
    ...font(700),
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: em(0.05, 11),
    textTransform: 'uppercase',
    color: colors.primaryEyebrow,
  },
  pageTitle: {
    ...font(800),
    fontSize: 31,
    lineHeight: 39,
    letterSpacing: em(-0.025, 31),
    color: colors.text,
  },
  sheetTitle: {
    ...font(800),
    fontSize: 22,
    lineHeight: 29,
    letterSpacing: em(-0.025, 22),
    color: colors.text,
  },
  dialogTitle: {
    ...font(800),
    fontSize: 20,
    lineHeight: 28,
    letterSpacing: em(-0.025, 20),
    color: colors.text,
  },
  sectionTitle: { ...font(700), fontSize: 18, lineHeight: 26, color: colors.text },
  cardTitle: { ...font(700), fontSize: 16, lineHeight: 22, color: colors.text },
  rowTitle: { ...font(700), fontSize: 14, lineHeight: 20, color: colors.text },
  body: { ...font(400), fontSize: 14, lineHeight: 20, color: colors.textBody },
  bodyLarge: { ...font(400), fontSize: 15, lineHeight: 22, color: colors.textBody },
  label: { ...font(600), fontSize: 13, lineHeight: 18, color: colors.textStrong },
  meta: { ...font(400), fontSize: 12, lineHeight: 16, color: colors.textMuted },
  small: { ...font(500), fontSize: 11, lineHeight: 14, color: colors.textMuted },
  moneyXL: {
    ...font(900),
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: em(-0.025, 40),
    color: colors.text,
  },
  moneyL: {
    ...font(900),
    fontSize: 26,
    lineHeight: 31,
    letterSpacing: em(-0.025, 26),
    color: colors.text,
  },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;

export const radius = {
  pageCard: 24,
  listCard: 20,
  iconTile: 12,
  iconTileLarge: 16,
  input: 16,
  button: 16,
  toast: 14,
  sheet: 28,
  dialog: 28,
  pill: 999,
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  screen: 20,
  section: 16,
  card: 16,
} as const;

/** CSS box-shadow strings (React Native 0.76+ supports `boxShadow` on both platforms). */
export const shadows = {
  card: '0px 2px 8px rgba(0,0,0,0.02)',
  primaryButton: '0px 10px 15px -3px rgba(83,158,47,0.3)',
  fab: '0px 10px 15px -3px rgba(83,158,47,0.3), 0px 4px 6px -4px rgba(83,158,47,0.3)',
  iconButton: '0px 4px 10px -2px rgba(83,158,47,0.35)',
  sheet: '0px -10px 30px rgba(0,0,0,0.12)',
  dialog: '0px 20px 40px -10px rgba(0,0,0,0.25)',
  toast: '0px 10px 15px -3px rgba(0,0,0,0.2)',
  focusRing: '0px 0px 0px 4px rgba(83,158,47,0.12)',
  /** Selected segment of a segmented control (Budget.html). */
  segment: '0px 1px 3px rgba(0,0,0,0.08)',
  /** Landing.html floating callouts and phone frame. */
  callout: '0px 14px 28px -12px rgba(0,0,0,0.2)',
  device: '0px 30px 50px -20px rgba(31,72,18,0.45)',
} as const;

export const sizes = {
  touchTarget: 44,
  buttonPrimary: 52,
  buttonSecondary: 48,
  input: 52,
  iconButton: 44,
  avatar: 36,
  listIconTile: 40,
  navHeight: 88,
  navPill: { width: 56, height: 32 },
  fab: 52,
  /** Distance of floating elements (FAB, toast) above the screen bottom, clearing the nav bar. */
  floatingBottom: 104,
  progress: { regular: 8, large: 10 },
} as const;

export const theme = { colors, categoryTones, typography, radius, spacing, shadows, sizes, font };
export default theme;
