/**
 * Phase 8C offline and network reliability: reconnect and foreground refetch, no paused
 * (queued) writes, no query retries while offline, and the offline strip.
 */
import {
  focusManager,
  onlineManager,
  QueryClientProvider,
  useMutation,
  useQuery,
} from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { useState, type ReactNode } from 'react';
import { AppState, Text, TextInput } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '../../src/api/client';
import { queryClient, shouldRetryQuery } from '../../src/api/queryClient';
import { OFFLINE_MESSAGE, OfflineBoundary } from '../../src/features/connectivity/OfflineBanner';
import {
  installConnectivity,
  isOnlineState,
  resetConnectivityForTests,
} from '../../src/lib/connectivity';
import { resetNetworkState, setNetworkState } from '../../test-utils/fakeNetInfo';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);

let appStateHandler: ((status: string) => void) | undefined;

beforeEach(() => {
  resetNetworkState();
  queryClient.clear();
  appStateHandler = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateHandler = handler as (status: string) => void;
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  resetConnectivityForTests();
  installConnectivity();
});

afterEach(async () => {
  jest.restoreAllMocks();
  await act(async () => setNetworkState({ isConnected: true, isInternetReachable: true }));
  focusManager.setFocused(undefined);
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

it('treats an unknown reachability as online, and only a definite "no" as offline', () => {
  expect(isOnlineState({ isConnected: true, isInternetReachable: null })).toBe(true);
  expect(isOnlineState({ isConnected: null, isInternetReachable: null })).toBe(true);
  expect(isOnlineState({ isConnected: false, isInternetReachable: null })).toBe(false);
  expect(isOnlineState({ isConnected: true, isInternetReachable: false })).toBe(false);
});

it('follows NetInfo into TanStack Query', async () => {
  expect(onlineManager.isOnline()).toBe(true);
  await act(async () => setNetworkState({ isConnected: false }));
  expect(onlineManager.isOnline()).toBe(false);
  await act(async () => setNetworkState({ isConnected: true }));
  expect(onlineManager.isOnline()).toBe(true);
});

it('refetches a query that failed offline as soon as the connection returns', async () => {
  await act(async () => setNetworkState({ isConnected: false }));
  let online = false;
  const fetcher = jest.fn(async () => {
    if (!online) throw new ApiError('network', 0);
    return 'fresh';
  });
  const { result } = await renderHook(
    () => useQuery({ queryKey: ['reconnect'], queryFn: fetcher }),
    {
      wrapper,
    },
  );
  // Not paused on a skeleton: it tries, fails once (no retries offline) and shows the error.
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(fetcher).toHaveBeenCalledTimes(1);

  online = true;
  await act(async () => setNetworkState({ isConnected: true }));
  await waitFor(() => expect(result.current.data).toBe('fresh'));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('refetches stale data when the app comes back to the foreground', async () => {
  let n = 0;
  const fetcher = jest.fn(async () => ++n);
  const { result } = await renderHook(
    () => useQuery({ queryKey: ['foreground'], queryFn: fetcher, staleTime: 0 }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.data).toBe(1));
  expect(appStateHandler).toBeDefined();

  await act(async () => appStateHandler!('background'));
  expect(focusManager.isFocused()).toBe(false);
  await act(async () => appStateHandler!('active'));
  await waitFor(() => expect(result.current.data).toBe(2));
});

it('does not refetch fresh data on foreground (staleTime is respected)', async () => {
  const fetcher = jest.fn(async () => 'once');
  const { result } = await renderHook(
    () => useQuery({ queryKey: ['fresh'], queryFn: fetcher, staleTime: 60_000 }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.data).toBe('once'));
  await act(async () => appStateHandler!('background'));
  await act(async () => appStateHandler!('active'));
  await act(async () => {});
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('never pauses a write while offline: it fails right away and is not replayed later', async () => {
  await act(async () => setNetworkState({ isConnected: false }));
  const send = jest.fn(async () => {
    throw new ApiError('network', 0);
  });
  const { result } = await renderHook(() => useMutation({ mutationFn: send }), { wrapper });

  await act(async () => {
    await result.current.mutateAsync(undefined).catch(() => undefined);
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.isPaused).toBe(false);
  expect(send).toHaveBeenCalledTimes(1);

  // Reconnecting must not resend it (no hidden offline write queue).
  await act(async () => setNetworkState({ isConnected: true }));
  await act(async () => {
    await queryClient.resumePausedMutations();
  });
  expect(send).toHaveBeenCalledTimes(1);
});

it('retries only temporary failures, and not while offline', async () => {
  const network = new ApiError('network', 0);
  expect(shouldRetryQuery(0, network)).toBe(true);
  expect(shouldRetryQuery(2, network)).toBe(false);
  expect(shouldRetryQuery(0, new ApiError('validation', 422))).toBe(false);
  await act(async () => setNetworkState({ isConnected: false }));
  expect(shouldRetryQuery(0, network)).toBe(false);
});

describe('OfflineBoundary', () => {
  function Probe() {
    const insets = useSafeAreaInsets();
    return <Text>screen top inset {insets.top}</Text>;
  }

  const metrics = {
    frame: { x: 0, y: 0, width: 400, height: 800 },
    insets: { top: 24, left: 0, right: 0, bottom: 16 },
  };

  it('shows the strip only while offline and moves the status-bar inset to it', async () => {
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <OfflineBoundary>
          <Probe />
        </OfflineBoundary>
      </SafeAreaProvider>,
    );
    expect(screen.queryByText(OFFLINE_MESSAGE)).toBeNull();
    expect(screen.getByText('screen top inset 24')).toBeOnTheScreen();

    await act(async () => setNetworkState({ isConnected: false }));
    expect(screen.getByText(OFFLINE_MESSAGE)).toBeOnTheScreen();
    expect(screen.getByRole('alert', { name: OFFLINE_MESSAGE })).toBeOnTheScreen();
    // The screen below isn't padded twice under the strip.
    expect(screen.getByText('screen top inset 0')).toBeOnTheScreen();

    await act(async () => setNetworkState({ isConnected: true }));
    expect(screen.queryByText(OFFLINE_MESSAGE)).toBeNull();
    expect(screen.getByText('screen top inset 24')).toBeOnTheScreen();
  });

  it('keeps the screens mounted, so unsaved form values survive a dropped connection', async () => {
    function Draft() {
      const [value, setValue] = useState('');
      return <TextInput accessibilityLabel="Merchant" value={value} onChangeText={setValue} />;
    }
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <OfflineBoundary>
          <Draft />
        </OfflineBoundary>
      </SafeAreaProvider>,
    );
    await fireEvent.changeText(screen.getByLabelText('Merchant'), 'ZZ Test Mart');
    await act(async () => setNetworkState({ isConnected: false }));
    expect(screen.getByLabelText('Merchant').props.value).toBe('ZZ Test Mart');
    await act(async () => setNetworkState({ isConnected: true }));
    expect(screen.getByLabelText('Merchant').props.value).toBe('ZZ Test Mart');
  });
});
