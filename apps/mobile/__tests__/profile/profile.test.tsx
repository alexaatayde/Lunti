/**
 * D1 (emulator validation 2026-11-13): Profile was still the build-step-1 placeholder, showing
 * "Placeholder" and an internal design-file path to users.
 */
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { queryClient } from '../../src/api/queryClient';
import { useSessionStore } from '../../src/stores/session';
import { ME, mockApi, problem, reply } from '../../test-utils/fakeApi';
import { fakeAuth, fakeSession, resetFakeSupabase } from '../../test-utils/fakeSupabase';
import { PRELOAD_TIMEOUT_MS, preloadRoutes } from '../../test-utils/preloadRoutes';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);

const appDir = './app';
let api: ReturnType<typeof mockApi>;

beforeAll(() => preloadRoutes(), PRELOAD_TIMEOUT_MS);

beforeEach(() => {
  useSessionStore.setState({ status: 'loading', session: null });
  resetFakeSupabase(fakeSession());
  queryClient.clear();
  api = mockApi();
});

afterEach(() => api.restore());

const open = () => renderRouter(appDir, { initialUrl: '/profile' });

it('shows the signed-in user from GET /me, with no placeholder or design-file text', async () => {
  await open();

  expect(await screen.findByText('Alex Reyes')).toBeOnTheScreen();
  expect(screen.getByText('alex@example.com')).toBeOnTheScreen();
  expect(screen.getByText('A')).toBeOnTheScreen(); // avatar initial
  expect(screen.getByRole('header', { name: 'Profile' })).toBeOnTheScreen();
  expect(screen.queryByText(/placeholder/i)).toBeNull();
  expect(screen.queryByText(/design\//)).toBeNull();
  expect(screen.queryByText(/\.html|\.png/)).toBeNull();
});

it('shows account facts from the API', async () => {
  api.set('GET /api/v1/me', { ...ME, data_consent_at: '2026-11-05T02:00:00Z' });
  await open();

  expect(await screen.findByLabelText('Currency: Philippine peso (₱)')).toBeOnTheScreen();
  expect(screen.getByLabelText('Data processing consent: Given Nov 5, 2026')).toBeOnTheScreen();
  expect(screen.getByLabelText('Member since: Nov 4, 2026')).toBeOnTheScreen();
});

it('shows the app version and names a non-production build (Phase 8D.1)', async () => {
  await open();
  // Tests run as a development bundle, which must say so.
  expect(await screen.findByLabelText(/^Version: .+ · Development build$/)).toBeOnTheScreen();
});

it('handles a profile with no name or consent on record', async () => {
  api.set('GET /api/v1/me', { ...ME, full_name: null, data_consent_at: null });
  await open();

  expect(await screen.findByText('No name yet')).toBeOnTheScreen();
  expect(screen.getByText('A')).toBeOnTheScreen(); // falls back to the email's initial
  expect(screen.getByLabelText('Data processing consent: Not recorded')).toBeOnTheScreen();
});

it('opens the notification settings', async () => {
  const router = await open();

  await fireEvent.press(await screen.findByRole('button', { name: /^Notification settings/ }));
  expect(router.getPathname()).toBe('/notifications');
});

it('switches back to Budget with the segment', async () => {
  const router = await open();
  await screen.findByText('Alex Reyes');

  // The bottom nav has a Budget tab too: use the Budget / Profile segment.
  const segment = screen.getByLabelText('Budget or Profile');
  await fireEvent.press(within(segment).getByRole('tab', { name: 'Budget' }));
  await waitFor(() => expect(router.getPathname()).toBe('/budget'));
});

it('shows an error with retry when the profile cannot load, and keeps Log out', async () => {
  let fail = true;
  api.set('GET /api/v1/me', () => (fail ? problem(503, 'Service unavailable.') : reply(200, ME)));
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retry: false } });
  try {
    await open();
    expect(
      await screen.findByRole('button', { name: 'Try again' }, { timeout: 4000 }),
    ).toBeOnTheScreen();
    expect(screen.queryByText('Alex Reyes')).toBeNull();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeOnTheScreen();

    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Alex Reyes')).toBeOnTheScreen();
  } finally {
    queryClient.setDefaultOptions(defaults);
  }
});

it('logs out', async () => {
  const router = await open();
  await screen.findByText('Alex Reyes');

  await fireEvent.press(screen.getByRole('button', { name: 'Log out' }));
  expect(fakeAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  await waitFor(() => expect(router.getPathname()).toBe('/welcome'));
});
