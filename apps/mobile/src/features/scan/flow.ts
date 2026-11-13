/** Navigation and messages shared by the scan screens. */
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

import { ApiError } from '../../api/client';
import { discardReceipt } from '../../api/hooks';
import { useScanStore } from '../../stores/scan';

/**
 * Deletes an unconfirmed receipt and its photo in the background. Used when the user cancels,
 * retakes or leaves a failed scan; a failure only leaves an unsaved draft on the server.
 */
export function discardQuietly(receiptId: string | null | undefined) {
  if (!receiptId) return;
  discardReceipt(receiptId).catch(() => undefined);
}

/** Clears the scan and closes the flow. */
export function leaveScan() {
  useScanStore.getState().reset();
  if (router.canGoBack()) router.back();
  else router.replace('/home');
}

/** Clears the scan (discarding any unsaved receipt) and opens a fresh camera. */
export function restartScan() {
  discardQuietly(useScanStore.getState().receipt?.id);
  useScanStore.getState().reset();
  router.replace('/scan/camera');
}

/** Clears the scan (discarding any unsaved receipt) and opens the manual expense form. */
export function enterManually() {
  discardQuietly(useScanStore.getState().receipt?.id);
  useScanStore.getState().reset();
  router.replace({ pathname: '/expense-form', params: { mode: 'add' } });
}

/**
 * Routes the Android back button through the screen's own Cancel logic, so leaving the scan
 * never keeps a stale photo in the store or an unsaved draft on the server. `null` = default.
 */
export function useHardwareBack(onBack: (() => void) | null) {
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });
  const active = onBack !== null;
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      latest.current?.();
      return true;
    });
    return () => sub.remove();
  }, [active]);
}

export function uploadMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413) return 'This photo is too large. Try another one.';
    if (error.kind === 'validation') {
      return error.problem?.errors?.[0]?.message ?? "This photo can't be used. Try another one.";
    }
    if (error.kind === 'unavailable') {
      return error.problem?.detail ?? 'Receipt reading is unavailable right now. Please try again.';
    }
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
