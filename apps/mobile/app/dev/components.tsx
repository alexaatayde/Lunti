/**
 * Dev-only component gallery: every shared component in every variant, to compare against
 * design/screenshots. Not reachable in production builds.
 */
import { Redirect, router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AlertDialog,
  AmountInput,
  AnalyticsIcon,
  AppHeader,
  AppText,
  ArrowRightIcon,
  BagIcon,
  Badge,
  BottomNav,
  BottomSheet,
  BudgetIcon,
  Button,
  CalendarIcon,
  CameraIcon,
  Card,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Chip,
  ClockBadge,
  ClockIcon,
  CloseIcon,
  EditIcon,
  EyeIcon,
  Fab,
  FilterChip,
  HomeIcon,
  IconButton,
  iconTileColor,
  InfoIcon,
  ListRow,
  LockIcon,
  MailIcon,
  MealsIcon,
  PageTitle,
  PlusIcon,
  ProgressBar,
  SearchIcon,
  TextField,
  TintCard,
  Toast,
  TransactionsIcon,
  TrashIcon,
  UserIcon,
  type TabKey,
} from '../../src/components';
import { colors, font, radius, spacing } from '../../src/theme';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="sectionTitle">{title}</AppText>
      {children}
    </View>
  );
}

const smallIcons = [
  ['chevron-right', ChevronRightIcon],
  ['chevron-down', ChevronDownIcon],
  ['plus', PlusIcon],
  ['camera', CameraIcon],
  ['search', SearchIcon],
  ['calendar', CalendarIcon],
  ['trash', TrashIcon],
  ['edit', EditIcon],
  ['check', CheckIcon],
  ['close', CloseIcon],
  ['clock', ClockIcon],
  ['arrow', ArrowRightIcon],
  ['user', UserIcon],
  ['info', InfoIcon],
  ['mail', MailIcon],
  ['lock', LockIcon],
  ['eye', EyeIcon],
  ['bag', BagIcon],
] as const;

const navIcons = [AnalyticsIcon, BudgetIcon, HomeIcon, MealsIcon, TransactionsIcon];

export default function ComponentGallery() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabKey>('home');
  const [filter, setFilter] = useState('All');
  const [email, setEmail] = useState('alex@example.com');
  const [password, setPassword] = useState('');
  const [amount, setAmount] = useState('6.75');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState<'none' | 'saved' | 'deleted'>('none');
  const [showFab, setShowFab] = useState(true);

  if (!__DEV__) return <Redirect href="/home" />;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <AppHeader onAvatarPress={() => router.push('/profile')} />
      <ScrollView contentContainerStyle={styles.content}>
        <PageTitle eyebrow="Dev only" title="Component gallery" />
        <Button label="Back" variant="ghost" onPress={() => router.back()} />

        <Section title="Typography">
          <AppText variant="eyebrow">Your food, in good shape</AppText>
          <AppText variant="pageTitle">Today, at a glance</AppText>
          <AppText variant="sectionTitle">Pantry pulse</AppText>
          <AppText variant="cardTitle">3 items are nearing their best</AppText>
          <AppText variant="body">Cook them in time and save an estimated ₱14.20.</AppText>
          <AppText variant="meta">Groceries · Scanned · 7 items</AppText>
          <AppText variant="small">Caption / nav label</AppText>
          <AppText variant="moneyXL">₱512.40</AppText>
          <AppText variant="moneyL" color={colors.primaryDeep}>
            ₱337.60
          </AppText>
        </Section>

        <Section title="PageTitle with action">
          <PageTitle
            eyebrow="Every purchase, in one place"
            title="Transactions"
            action={
              <IconButton
                accessibilityLabel="Add a transaction"
                icon={<PlusIcon size={20} color={colors.textOnPrimary} />}
              />
            }
          />
        </Section>

        <Section title="Card / TintCard">
          <Card>
            <AppText variant="cardTitle">Card (page, radius 24)</AppText>
            <AppText variant="meta">White, border token, soft shadow</AppText>
          </Card>
          <TintCard>
            <AppText variant="small" style={styles.upper}>
              Spent in May
            </AppText>
            <View style={styles.row}>
              <AppText variant="moneyL">₱1,284.60</AppText>
              <View style={styles.badgeCol}>
                <Badge label="31 scanned" tone="outline" />
                <Badge label="11 manual" tone="neutral" />
              </View>
            </View>
          </TintCard>
        </Section>

        <Section title="ListRow (in a list Card)">
          <Card size="list" padding={0}>
            <ListRow
              icon={<BagIcon size={20} color={iconTileColor('primary')} />}
              title="Greenfield Market"
              meta="Groceries · Scanned · 7 items"
              value="₱46.80"
              time="10:42 am"
              onPress={() => setToast('saved')}
            />
            <ListRow
              divider
              iconTone="warn"
              icon={<ClockIcon size={20} color={iconTileColor('warn')} />}
              title="Corner Café"
              meta="Dining out · Manual"
              value="₱6.75"
              time="8:15 am"
              onPress={() => setToast('saved')}
            />
            <ListRow
              divider
              iconTone="neutral"
              icon={<EditIcon size={20} color={iconTileColor('neutral')} />}
              title="Row without press handler"
              meta="Neutral tile"
            />
          </Card>
        </Section>

        <Section title="Chip / FilterChip">
          <Chip label="Dining out" dotColor={colors.primary} />
          <Chip label="No dot" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chips}>
              <FilterChip
                label="May"
                accessibilityLabel="Month: May"
                leading={<CalendarIcon size={14} color={colors.text} />}
                trailing={<ChevronDownIcon size={12} color={colors.text} />}
              />
              {['All', 'Groceries', 'Dining out', 'Transport'].map((f) => (
                <FilterChip key={f} label={f} active={filter === f} onPress={() => setFilter(f)} />
              ))}
            </View>
          </ScrollView>
        </Section>

        <Section title="Button">
          <Button
            label="Save expense"
            leftIcon={<CheckIcon size={18} color={colors.textOnPrimary} strokeWidth={2.5} />}
          />
          <Button
            label="Sign in"
            rightIcon={<ArrowRightIcon size={18} color={colors.textOnPrimary} />}
          />
          <Button label="Secondary" variant="secondary" />
          <Button label="Delete" variant="danger" />
          <Button label="Keep it" variant="ghost" />
          <Button label="Disabled" disabled />
          <Button label="Loading" loading />
        </Section>

        <Section title="TextField">
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            leftIcon={<MailIcon size={18} color={colors.textFaint} />}
          />
          <TextField
            label="Password (tap to see focus ring)"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            leftIcon={<LockIcon size={18} color={colors.textFaint} />}
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Show password"
                style={styles.eye}
              >
                <EyeIcon size={18} color={colors.textMuted} />
              </Pressable>
            }
          />
          <TextField label="With error" value="not-an-email" error="Enter a valid email address" />
          <TextField
            label="Search transactions"
            hideLabel
            height={44}
            placeholder="Search store or item"
            leftIcon={<SearchIcon size={18} color={colors.textMuted} />}
          />
        </Section>

        <Section title="AmountInput">
          <AmountInput value={amount} onChangeText={setAmount} />
        </Section>

        <Section title="ProgressBar">
          <AppText variant="meta">Normal (large, 60%)</AppText>
          <ProgressBar value={0.6} size="large" accessibilityLabel="Food budget, 60% used" />
          <AppText variant="meta">Warn (97%) + badge</AppText>
          <ProgressBar value={0.97} tone="warn" accessibilityLabel="Dining out, 97% used" />
          <Badge label="Near limit" tone="warn" />
          <AppText variant="meta">Danger (104%) + badge</AppText>
          <ProgressBar value={1.04} tone="danger" accessibilityLabel="Transport, 104% used" />
          <Badge label="Exceeded" tone="danger" />
        </Section>

        <Section title="Badge">
          <View style={styles.wrap}>
            <Badge label="60% of cap" tone="success" />
            <Badge label="31 scanned" tone="outline" />
            <Badge label="11 manual" tone="neutral" />
            <Badge label="Near limit" tone="warn" />
            <Badge label="Exceeded" tone="danger" />
            <ClockBadge label="Use today" />
          </View>
        </Section>

        <Section title="Icons">
          <AppText variant="meta">Nav icons: active / inactive</AppText>
          <View style={styles.wrap}>
            {navIcons.map((Icon, i) => (
              <View key={i} style={styles.iconPair}>
                <View style={styles.activePill}>
                  <Icon active />
                </View>
                <Icon />
              </View>
            ))}
          </View>
          <AppText variant="meta">Small icons</AppText>
          <View style={styles.wrap}>
            {smallIcons.map(([name, Icon]) => (
              <View key={name} style={styles.iconCell}>
                <Icon size={22} color={colors.textStrong} />
                <AppText variant="small">{name}</AppText>
              </View>
            ))}
          </View>
        </Section>

        <Section title="Overlays">
          <Button label="Open BottomSheet" variant="secondary" onPress={() => setSheetOpen(true)} />
          <Button label="Open AlertDialog" variant="secondary" onPress={() => setDialogOpen(true)} />
          <Button label="Toast: saved" variant="secondary" onPress={() => setToast('saved')} />
          <Button
            label="Toast: deleted + Undo"
            variant="secondary"
            onPress={() => setToast('deleted')}
          />
          <Button
            label={showFab ? 'Hide FAB' : 'Show FAB'}
            variant="secondary"
            onPress={() => setShowFab((v) => !v)}
          />
        </Section>
      </ScrollView>

      {showFab ? <Fab label="Scan receipt" onPress={() => setToast('saved')} /> : null}
      <Toast
        visible={toast !== 'none'}
        message={
          toast === 'deleted'
            ? 'Transaction deleted. Budget updated.'
            : 'Transaction saved. Budget updated.'
        }
        onUndo={toast === 'deleted' ? () => setToast('none') : undefined}
        onHide={() => setToast('none')}
      />
      <BottomNav active={tab} onSelect={setTab} bottomInset={insets.bottom} />

      <BottomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        eyebrow="New transaction"
        title="How do you want to add it?"
      >
        <TintCard size="list" padding={spacing.lg}>
          <AppText variant="cardTitle">Scan a receipt</AppText>
          <AppText variant="meta">Option cards come with the Transactions flow.</AppText>
        </TintCard>
        <Card size="list" padding={spacing.lg}>
          <AppText variant="cardTitle">Enter manually</AppText>
          <AppText variant="meta">For cash buys, bills or anything without a receipt.</AppText>
        </Card>
        <Button label="Cancel" variant="ghost" onPress={() => setSheetOpen(false)} />
      </BottomSheet>

      <AlertDialog
        visible={dialogOpen}
        title="Delete this transaction?"
        summary={{ label: 'Greenfield Market', value: '₱46.80' }}
        message={
          <>
            It will be removed from your history, and your May Food Budget goes back up to{' '}
            <AppText variant="meta" style={styles.strong}>
              ₱384.40
            </AppText>{' '}
            left.
          </>
        }
        cancelLabel="Keep it"
        confirmLabel="Delete"
        onCancel={() => setDialogOpen(false)}
        onConfirm={() => {
          setDialogOpen(false);
          setToast('deleted');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    paddingBottom: 160,
    gap: spacing.xxl,
  },
  section: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badgeCol: { gap: spacing.xs, alignItems: 'flex-end' },
  upper: { textTransform: 'uppercase', letterSpacing: 0.55 },
  chips: { flexDirection: 'row', gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  eye: {
    width: 40,
    height: 40,
    borderRadius: radius.iconTile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPair: { alignItems: 'center', gap: spacing.sm },
  activePill: {
    width: 56,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.navActiveBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCell: { width: 64, alignItems: 'center', gap: spacing.xs },
  strong: { ...font(700), color: colors.primaryDeep },
});
