/**
 * Connectivity and foreground tracking for server data (Phase 8C, AGENTS.md §8 "States").
 *
 * - NetInfo → TanStack `onlineManager`: when the connection comes back, queries that are
 *   stale (or failed while offline) refetch on their own (`refetchOnReconnect`).
 * - AppState → TanStack `focusManager`: returning to the app refetches stale queries
 *   (`refetchOnWindowFocus`), so balances aren't left hours old after the phone was locked.
 *
 * Writes are never queued here: mutations use `networkMode: 'always'` (queryClient.ts), so a
 * save while offline fails right away with a retryable error and the form keeps its values.
 * There is no offline write queue; that needs its own design review.
 */
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';

/**
 * Online unless NetInfo says otherwise. `isInternetReachable` is null until Android has
 * checked, and an unknown state must not block requests (the request itself will tell).
 */
export function isOnlineState(state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>) {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

let installed = false;

/** Connects NetInfo and AppState to TanStack Query. Safe to call more than once. */
export function installConnectivity(): void {
  if (installed) return;
  installed = true;

  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(isOnlineState(state))),
  );

  if (Platform.OS !== 'web') {
    focusManager.setEventListener((setFocused) => {
      const sub = AppState.addEventListener('change', (status: AppStateStatus) =>
        setFocused(status === 'active'),
      );
      return () => sub.remove();
    });
  }
}

/** For tests: lets `installConnectivity` run again after mocks change. */
export function resetConnectivityForTests(): void {
  installed = false;
}

/** Re-renders when the connection goes up or down. */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
    () => true,
  );
}
