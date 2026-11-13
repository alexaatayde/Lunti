/** A0 · Welcome (design/screens/Landing.html). */
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppHeader,
  AppText,
  ArrowRightIcon,
  BowlIcon,
  Button,
  buttonTextColor,
  CameraIcon,
  ClockIcon,
  PageTitle,
  ProgressBar,
  TintCard,
} from '../../src/components';
import { AuthLogo, LeafShape, SessionEndedNotice } from '../../src/features/auth/components';
import { colors, font, radius, shadows, spacing } from '../../src/theme';

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.scroll,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + 32 },
      ]}
    >
      <View style={styles.header}>
        <AuthLogo size="small" />
        <Pressable
          onPress={() => router.push('/sign-in')}
          accessibilityRole="link"
          accessibilityLabel="Skip to sign in"
          style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
        >
          <AppText style={styles.skipText}>Skip</AppText>
        </Pressable>
      </View>

      <Hero />

      <View style={styles.copy}>
        <AppText variant="eyebrow">Money + meals, in one app</AppText>
        <AppText style={styles.headline} accessibilityRole="header">
          {'Spend smarter.\n'}
          <AppText style={[styles.headline, styles.headlineAccent]}>Waste less.</AppText> Eat well.
        </AppText>
        <AppText style={styles.lead}>
          Scan your receipts to track every peso, get a nudge before staples run out, and cook with
          what&apos;s already at home.
        </AppText>
        {/* Intro pages 2–3 are not designed yet (DESIGN_HANDOFF.md §6), so no page dots. */}
      </View>

      <View style={styles.actions}>
        <SessionEndedNotice />
        <Button
          label="Get started"
          onPress={() => router.push('/sign-up')}
          rightIcon={<ArrowRightIcon size={18} color={buttonTextColor('primary')} />}
        />
        <Button
          label="I already have an account"
          variant="secondary"
          onPress={() => router.push('/sign-in')}
        />
      </View>
    </ScrollView>
  );
}

/** Tint panel with a phone showing a mini Home screen and three floating callouts. */
function Hero() {
  return (
    <View
      style={styles.hero}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Lunti preview: receipt scanned, rice running low, 95% pantry match"
    >
      <LeafShape size={300} color={colors.leafTint} style={styles.heroLeaf} />
      <View style={styles.phone}>
        <View style={styles.phoneScreen}>
          <MiniHome />
        </View>
      </View>

      <Callout
        style={styles.calloutScan}
        icon={
          <View style={[styles.calloutTile, styles.tileScan]}>
            <CameraIcon size={17} color={colors.textOnPrimary} />
          </View>
        }
        title="Receipt scanned"
        meta="7 items to review"
      />
      <Callout
        style={[styles.calloutRestock, styles.calloutWarn]}
        icon={
          <View style={[styles.calloutTile, styles.tileWarn]}>
            <ClockIcon size={17} color={colors.warnText} />
          </View>
        }
        title="Rice running low"
        meta="Rebuy in ~2 days"
      />
      <Callout
        style={styles.calloutMeal}
        icon={
          <View style={[styles.calloutTile, styles.tileMeal]}>
            <BowlIcon size={17} color={colors.primaryChipTextAlt} />
          </View>
        }
        title="95% pantry match"
        meta="Dinner is sorted"
      />
    </View>
  );
}

function Callout({
  icon,
  title,
  meta,
  style,
}: {
  icon: ReactNode;
  title: string;
  meta: string;
  style: object;
}) {
  return (
    <View style={[styles.callout, style]}>
      {icon}
      <View>
        <AppText style={styles.calloutTitle}>{title}</AppText>
        <AppText style={styles.calloutMeta}>{meta}</AppText>
      </View>
    </View>
  );
}

/** Home at full size (390 wide), scaled to fit the phone frame. Sample values for illustration. */
const PHONE_SCALE = 176 / 390;

function MiniHome() {
  return (
    <View style={styles.miniHome} pointerEvents="none">
      <AppHeader />
      <View style={styles.miniContent}>
        <PageTitle eyebrow="Your food, in good shape" title="Today, at a glance" />
        <TintCard padding={20}>
          <AppText variant="small" style={styles.miniLabel}>
            FOOD BUDGET
          </AppText>
          <View style={styles.miniRow}>
            <AppText style={styles.miniMoney}>₱5,124</AppText>
            <AppText variant="meta">spent so far</AppText>
          </View>
          <View style={styles.miniCap}>
            <AppText variant="meta">Monthly cap</AppText>
            <AppText variant="meta" color={colors.text}>
              ₱8,500
            </AppText>
          </View>
          <ProgressBar value={0.6} size="large" />
          <View style={styles.miniStats}>
            <View style={styles.flex}>
              <AppText variant="small">Still available</AppText>
              <AppText style={styles.miniStat}>₱3,376</AppText>
            </View>
            <View style={styles.flex}>
              <AppText variant="small">Safe daily pace</AppText>
              <AppText style={styles.miniStat}>₱281/day</AppText>
            </View>
          </View>
        </TintCard>
        <View style={styles.miniWarnCard}>
          <AppText variant="eyebrow" color={colors.warnStrong}>
            Use these next
          </AppText>
          <AppText variant="cardTitle">3 items are nearing their best</AppText>
          <AppText variant="meta">Cook them in time and save an estimated ₱142.</AppText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  header: {
    paddingHorizontal: spacing.screen,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  skip: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
  skipText: { ...font(600), fontSize: 14, lineHeight: 20, color: colors.primaryLink },

  hero: {
    height: 400,
    marginTop: spacing.md,
    marginHorizontal: spacing.screen,
    borderRadius: 32,
    backgroundColor: colors.surfaceTint,
    borderWidth: 1,
    borderColor: colors.borderTint,
    overflow: 'hidden',
  },
  heroLeaf: { right: -70, top: -50 },
  phone: {
    position: 'absolute',
    top: 40,
    left: '50%',
    marginLeft: -96,
    width: 192,
    height: 360,
    paddingTop: 8,
    paddingHorizontal: 8,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: colors.deviceFrame,
    boxShadow: shadows.device,
  },
  phoneScreen: {
    width: 176,
    height: 352,
    borderTopLeftRadius: 23,
    borderTopRightRadius: 23,
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  miniHome: {
    width: 390,
    transform: [{ scale: PHONE_SCALE }],
    transformOrigin: 'top left',
    backgroundColor: colors.bg,
  },
  miniContent: { paddingHorizontal: spacing.screen, paddingTop: spacing.md, gap: spacing.xl },
  miniLabel: { ...font(700), color: colors.textMuted },
  miniRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: spacing.xs },
  miniMoney: { ...font(900), fontSize: 34, lineHeight: 38, color: colors.text },
  miniCap: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: 6,
  },
  miniStats: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.lg },
  miniStat: { ...font(800), fontSize: 19, lineHeight: 26, color: colors.primaryDeep },
  miniWarnCard: {
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radius.pageCard,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.warnBg,
  },

  callout: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.iconTileLarge,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.calloutBorder,
    boxShadow: shadows.callout,
  },
  calloutScan: { left: 14, top: 92 },
  calloutRestock: { right: 12, top: 200 },
  calloutWarn: { borderColor: colors.warnBg },
  calloutMeal: { left: 22, bottom: 26 },
  calloutTile: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  tileScan: { borderRadius: 10, backgroundColor: colors.primary },
  tileWarn: { borderRadius: radius.pill, backgroundColor: colors.warnBg },
  tileMeal: { borderRadius: 10, backgroundColor: colors.primaryChipBg },
  calloutTitle: { ...font(700), fontSize: 12, lineHeight: 16, color: colors.text },
  calloutMeta: { ...font(400), fontSize: 11, lineHeight: 14, color: colors.textMuted },

  copy: { paddingTop: spacing.xxl, paddingHorizontal: spacing.xxl, gap: 10 },
  headline: {
    ...font(800),
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -0.96,
    color: colors.text,
  },
  headlineAccent: { color: colors.primary },
  lead: { ...font(400), fontSize: 15, lineHeight: 23, color: colors.textBody },

  actions: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.screen,
    gap: 10,
  },
});
