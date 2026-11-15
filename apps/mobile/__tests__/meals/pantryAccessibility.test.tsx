/**
 * Pantry accessibility: 48 dp targets for − / + / Confirm quantity, icons that scale with the
 * system font size, and a layout that follows a font-size change made while the screen is open
 * (the JS side of plugins/withFontScaleRefresh.ts: DeviceInfo → Dimensions "change").
 */
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Dimensions, StyleSheet } from 'react-native';

import { queryClient } from '../../src/api/queryClient';
import { useSessionStore } from '../../src/stores/session';
import { useToastStore } from '../../src/stores/toast';
import { mockApi, pantryItem, pantryPage, reply } from '../../test-utils/fakeApi';
import { fakeSession, resetFakeSupabase } from '../../test-utils/fakeSupabase';
import { PRELOAD_TIMEOUT_MS, preloadRoutes } from '../../test-utils/preloadRoutes';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);
jest.mock('@react-native-community/datetimepicker', () => ({
  DateTimePickerAndroid: { open: jest.fn() },
}));

const appDir = './app';
let api: ReturnType<typeof mockApi>;
const initialWindow = Dimensions.get('window');
const initialScreen = Dimensions.get('screen');

/** Same event React Native raises when DeviceInfo reports a new font scale. */
function setFontScale(fontScale: number) {
  Dimensions.set({
    window: { ...initialWindow, fontScale },
    screen: { ...initialScreen, fontScale },
  });
}

beforeAll(() => preloadRoutes(), PRELOAD_TIMEOUT_MS);

beforeEach(() => {
  useSessionStore.setState({ status: 'loading', session: null });
  useToastStore.setState({ message: null, onUndo: undefined });
  resetFakeSupabase(fakeSession());
  queryClient.clear();
  api = mockApi();
  setFontScale(1);
});

afterEach(() => {
  api.restore();
  // Plain call: the tree is already unmounted, and act() here would leak into the next test.
  setFontScale(initialWindow.fontScale);
});

const page = pantryPage({
  items: [
    pantryItem(),
    pantryItem({ id: 'pi-2', name: 'Spinach', quantity: '1.000', unit: 'bunch', confirmed: true }),
  ],
  in_stock_count: 2,
  estimated_count: 1,
});

const CONFIRM = 'Confirm Eggs at 12 pcs';

async function open() {
  api.set('GET /api/v1/pantry', page);
  await renderRouter(appDir, { initialUrl: '/meals/pantry' });
  return screen.findByRole('button', { name: CONFIRM }, { timeout: 4000 });
}

const boxOf = (name: string) =>
  StyleSheet.flatten(screen.getByRole('button', { name }).props.style) as Record<string, number>;

type HostNode = { type: string; props: Record<string, unknown>; children: (HostNode | string)[] };

/** Width of the single SVG icon inside a control (react-native-svg's host view). */
function iconSize(name: string): number {
  const found: number[] = [];
  const walk = (node: HostNode | string) => {
    if (typeof node === 'string') return;
    if (node.type === 'RNSVGSvgView') {
      found.push(Number(node.props.width));
      return;
    }
    node.children.forEach(walk);
  };
  walk(screen.getByRole('button', { name }) as unknown as HostNode);
  if (found.length !== 1) throw new Error(`Expected one icon in "${name}", found ${found.length}`);
  return found[0];
}

describe.each([
  [0.85, { step: 48, stepIcon: 18, check: 16 }],
  [1, { step: 48, stepIcon: 18, check: 16 }],
  [1.3, { step: 48, stepIcon: 23, check: 21 }],
  [2, { step: 49, stepIcon: 27, check: 32 }],
])('at font scale %s', (fontScale, expected) => {
  beforeEach(() => setFontScale(fontScale));

  it('keeps − / + at least 48 × 48 dp, round, with matching icons', async () => {
    await open();
    for (const name of ['Less Eggs', 'More Eggs']) {
      const box = boxOf(name);
      expect(box.width).toBe(expected.step);
      expect(box.height).toBe(expected.step);
      expect(box.width).toBeGreaterThanOrEqual(48);
      expect(box.borderRadius).toBe(expected.step / 2);
      expect(iconSize(name)).toBe(expected.stepIcon);
    }
    // − and + have the same visual size (− used to be a text glyph).
    expect(iconSize('Less Eggs')).toBe(iconSize('More Eggs'));
    // The glyph never crowds the ring.
    expect(expected.step - expected.stepIcon).toBeGreaterThanOrEqual(22);
  });

  it('gives Confirm quantity a 48 dp minimum height and a check that scales with its text', async () => {
    await open();
    expect(boxOf(CONFIRM).minHeight).toBeGreaterThanOrEqual(48);
    expect(iconSize(CONFIRM)).toBe(expected.check);
  });
});

it('lays the row out side by side at 100 % and stacked at 200 %', async () => {
  const confirm = await open();
  const row = () =>
    StyleSheet.flatten(
      screen.getByRole('button', { name: 'Edit Eggs, 12 pcs, estimated' }).parent?.parent?.props
        .style,
    );
  expect(row().flexDirection).toBe('row');
  expect(confirm).toBeOnTheScreen();

  await act(async () => setFontScale(2));
  expect(row().flexDirection).toBe('column');
});

it('follows a font-size change while the screen stays open, without reloading it', async () => {
  await open();
  const loads = api.calls('GET', '/api/v1/pantry').length;
  expect(iconSize('More Eggs')).toBe(18);
  expect(iconSize(CONFIRM)).toBe(16);

  await act(async () => setFontScale(2));
  expect(iconSize('More Eggs')).toBe(27);
  expect(iconSize('Less Eggs')).toBe(27);
  expect(iconSize(CONFIRM)).toBe(32);
  expect(boxOf('More Eggs').width).toBe(49);

  await act(async () => setFontScale(1));
  expect(iconSize('More Eggs')).toBe(18);
  expect(iconSize(CONFIRM)).toBe(16);
  expect(boxOf('More Eggs').width).toBe(48);

  // Same screen instance and data: no refetch, nothing remounted.
  expect(api.calls('GET', '/api/v1/pantry')).toHaveLength(loads);
  expect(screen.getByRole('button', { name: CONFIRM })).toBeOnTheScreen();
});

describe('behaviour is unchanged at 200 %', () => {
  beforeEach(() => setFontScale(2));

  it('Confirm quantity sends only { confirmed: true }, once, even when tapped again in flight', async () => {
    let release: (r: ReturnType<typeof reply>) => void = () => undefined;
    api.set(
      'PATCH /api/v1/pantry/pi-1',
      () => new Promise<ReturnType<typeof reply>>((resolve) => (release = resolve)),
    );
    const confirm = await open();
    await fireEvent.press(confirm);
    await fireEvent.press(confirm); // second tap while the first is still on its way
    expect(await screen.findByText('Confirming…')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'More Eggs' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Less Eggs' })).toBeDisabled();
    release(reply(200, pantryItem({ confirmed: true })));
    await waitFor(() => expect(useToastStore.getState().message).toBe('Eggs confirmed at 12 pcs.'));
    expect(api.calls('PATCH', '/api/v1/pantry/pi-1').map((c) => c.body)).toEqual([
      { confirmed: true },
    ]);
  });

  it('− and + still step the amount by one', async () => {
    api.set('PATCH /api/v1/pantry/pi-1', (_r: Request, body: unknown) =>
      reply(200, pantryItem({ ...(body as object), confirmed: true })),
    );
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'More Eggs' }));
    await waitFor(() =>
      expect(api.calls('PATCH', '/api/v1/pantry/pi-1')[0]?.body).toEqual({ quantity: '13' }),
    );
  });
});
