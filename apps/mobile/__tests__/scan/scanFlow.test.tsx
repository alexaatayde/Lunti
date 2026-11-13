import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { BackHandler } from 'react-native';

import { queryClient } from '../../src/api/queryClient';
import { useScanStore } from '../../src/stores/scan';
import { useSessionStore } from '../../src/stores/session';
import { useToastStore } from '../../src/stores/toast';
import {
  BLOCKED,
  camera,
  GRANTED,
  resetFakeCamera,
  UNDETERMINED,
} from '../../test-utils/fakeCamera';
import { mockApi, problem, reply, txn } from '../../test-utils/fakeApi';
import { failedReceipt, receipt } from '../../test-utils/fakeReceipt';
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
const RECEIPTS = '/api/v1/receipts';
const RID = receipt().id;
let api: ReturnType<typeof mockApi>;

// Load the route tree once, outside any single test's timeout (see preloadRoutes.ts).
beforeAll(() => preloadRoutes(), PRELOAD_TIMEOUT_MS);

beforeEach(() => {
  useSessionStore.setState({ status: 'loading', session: null });
  useToastStore.setState({ message: null, onUndo: undefined });
  useScanStore.getState().reset();
  resetFakeSupabase(fakeSession());
  resetFakeCamera(GRANTED);
  queryClient.clear();
  api = mockApi();
});

afterEach(() => api.restore());

/** Presses the Android back button: the most recently added listener runs first. */
async function pressHardwareBack() {
  const calls = (BackHandler.addEventListener as jest.Mock).mock.calls;
  const removed = new Set(
    (BackHandler.addEventListener as jest.Mock).mock.results
      .map((r, i) => ((r.value as { removed?: boolean }).removed ? i : -1))
      .filter((i) => i >= 0),
  );
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    if (!removed.has(i) && calls[i][0] === 'hardwareBackPress') {
      await act(async () => {
        calls[i][1]();
      });
      return;
    }
  }
  throw new Error('No back handler registered');
}

let backSpy: jest.SpyInstance;
beforeEach(() => {
  backSpy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation(() => {
    const sub = { removed: false, remove: () => (sub.removed = true) };
    return sub as unknown as ReturnType<typeof BackHandler.addEventListener>;
  });
});

afterEach(() => backSpy.mockRestore());

async function capture() {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Capture receipt' })).toBeEnabled(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Capture receipt' }));
  expect(await screen.findByRole('button', { name: 'Use photo' })).toBeOnTheScreen();
}

describe('Scan camera', () => {
  it('asks for camera permission before showing the camera', async () => {
    resetFakeCamera(UNDETERMINED);
    await renderRouter(appDir, { initialUrl: '/scan/camera' });

    expect(await screen.findByText('Allow camera access')).toBeOnTheScreen();
    expect(screen.queryByTestId('camera-preview')).toBeNull();
    expect(screen.getByRole('button', { name: 'Capture receipt' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Allow camera' }));
    expect(camera.requestPermission).toHaveBeenCalled();
    // The gallery still works without camera access.
    expect(screen.getByRole('button', { name: 'Gallery' })).toBeEnabled();
  });

  it('sends people to Settings when camera access is blocked', async () => {
    resetFakeCamera(BLOCKED);
    await renderRouter(appDir, { initialUrl: '/scan/camera' });

    expect(await screen.findByText('Camera access is off')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Open settings' })).toBeOnTheScreen();
  });

  it('captures, previews and retakes without uploading', async () => {
    await renderRouter(appDir, { initialUrl: '/scan/camera' });
    await capture();

    expect(screen.getByLabelText('Receipt photo')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Retake' }));

    expect(await screen.findByTestId('camera-preview')).toBeOnTheScreen();
    expect(api.calls('POST', RECEIPTS)).toHaveLength(0);
    expect(useScanStore.getState().photo).toBeNull();
  });

  it('uploads the photo and opens the review', async () => {
    api.set(`POST ${RECEIPTS}`, receipt());
    const router = await renderRouter(appDir, { initialUrl: '/scan/camera' });
    await capture();

    await fireEvent.press(screen.getByRole('button', { name: 'Use photo' }));

    expect(await screen.findByText('Receipt scan')).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/scan/review');
    expect(api.calls('POST', RECEIPTS)).toHaveLength(1);
    const [url, init] = api.fetchMock.mock.calls.find(([input]) => typeof input === 'string')!;
    expect(url).toBe('https://api.lunti.test/api/v1/receipts');
    expect((init?.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it('opens the failed screen when the photo is unreadable', async () => {
    api.set(`POST ${RECEIPTS}`, failedReceipt('no_amounts'));
    const router = await renderRouter(appDir, { initialUrl: '/scan/camera' });
    await capture();

    await fireEvent.press(screen.getByRole('button', { name: 'Use photo' }));

    expect(await screen.findByText("We couldn't read this receipt")).toBeOnTheScreen();
    expect(
      screen.getByText("We couldn't find any prices or a total in this photo. Nothing was saved."),
    ).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/scan/failed');
  });

  it('keeps the same upload id when retrying after a connection error', async () => {
    let attempts = 0;
    api.set(`POST ${RECEIPTS}`, () => {
      attempts += 1;
      return attempts === 1
        ? problem(503, 'Receipt reading is unavailable right now. Please try again.')
        : reply(201, receipt());
    });
    await renderRouter(appDir, { initialUrl: '/scan/camera' });
    await capture();
    const uploadId = useScanStore.getState().uploadId;

    await fireEvent.press(screen.getByRole('button', { name: 'Use photo' }));
    expect(
      await screen.findByText('Receipt reading is unavailable right now. Please try again.'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Enter the expense manually' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Receipt scan')).toBeOnTheScreen();
    expect(attempts).toBe(2);
    expect(useScanStore.getState().uploadId).toBe(uploadId);
  });

  it('shows the server reason for a photo it rejects', async () => {
    api.set(`POST ${RECEIPTS}`, () =>
      problem(422, 'The request has invalid fields.', [
        { field: 'image', message: 'The image is larger than 10 MB.', code: 'too_large' },
      ]),
    );
    await renderRouter(appDir, { initialUrl: '/scan/camera' });
    await capture();
    await fireEvent.press(screen.getByRole('button', { name: 'Use photo' }));

    expect(await screen.findByText('The image is larger than 10 MB.')).toBeOnTheScreen();
  });

  it('picks a receipt from the gallery', async () => {
    camera.pickerResult = {
      canceled: false,
      assets: [{ uri: 'file:///photos/receipt.png', mimeType: 'image/png' }],
    };
    await renderRouter(appDir, { initialUrl: '/scan/camera' });

    await fireEvent.press(await screen.findByRole('button', { name: 'Gallery' }));

    expect(await screen.findByRole('button', { name: 'Use photo' })).toBeOnTheScreen();
    expect(useScanStore.getState().photo).toEqual({
      uri: 'file:///photos/receipt.png',
      mimeType: 'image/png',
      fileName: 'receipt.png',
    });
  });
});

describe('Receipt review', () => {
  async function openReview(r = receipt()) {
    // Set before rendering (outside act: the router renders on its own clock).
    useScanStore.getState().setPhoto({
      uri: 'file:///cache/receipt-photo.jpg',
      mimeType: 'image/jpeg',
      fileName: 'receipt.jpg',
    });
    useScanStore.getState().setReceipt(r);
    const router = await renderRouter(appDir, { initialUrl: '/scan/review' });
    expect(await screen.findByText('Receipt scan', {}, { timeout: 4000 })).toBeOnTheScreen();
    return router;
  }

  it('shows what OCR read, with confidence and review flags', async () => {
    await openReview(
      receipt({
        confidence: { store: 62, items: 90, total: 89 },
        flags: [
          {
            field: 'occurred_at',
            code: 'ambiguous',
            message: 'Check the date: day and month could be swapped.',
          },
        ],
      }),
    );

    expect(screen.getByLabelText('Store confidence 62 percent, check it')).toBeOnTheScreen();
    expect(screen.getByLabelText('Items confidence 90 percent')).toBeOnTheScreen();
    expect(screen.getByText('Check the date: day and month could be swapped.')).toBeOnTheScreen();
    expect(screen.getByText('BEAR BRAND 33G')).toBeOnTheScreen();
    expect(screen.getByText('Items match the receipt total.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Save receipt' })).toBeOnTheScreen();
    expect(screen.queryByText(/Simulated OCR/)).toBeNull();
  });

  it('labels simulated development results', async () => {
    await openReview(receipt({ simulated: true, ocr_engine: 'fixture' }));
    expect(screen.getByText(/Simulated OCR \(development\)/)).toBeOnTheScreen();
  });

  it('saves only when the user confirms, then shows the toast', async () => {
    api.set(`POST ${RECEIPTS}/${RID}/confirm`, () =>
      reply(200, {
        ...txn({ amount: '140.00', source: 'receipt', receipt_id: RID, item_count: 2 }),
        budget_alerts: [],
        already_confirmed: false,
      }),
    );
    const router = await openReview();
    expect(api.calls('POST', `${RECEIPTS}/${RID}/confirm`)).toHaveLength(0);

    await fireEvent.press(screen.getByRole('button', { name: 'Increase quantity of EGGS LARGE' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Use ₱252.00 as the total' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save receipt' }));

    await waitFor(() => expect(router.getPathname()).toBe('/transactions'));
    const [sent] = api.calls('POST', `${RECEIPTS}/${RID}/confirm`);
    expect(sent.body).toMatchObject({
      category_id: 'c-groceries',
      merchant: 'ZZ TEST MART',
      total: '252.00',
      discount: '9.50',
      items: [
        { name: 'BEAR BRAND 33G', quantity: '3', unit_price: '12.50' },
        { name: 'EGGS LARGE', quantity: '2', unit_price: '112.00' },
      ],
    });
    expect(useToastStore.getState().message).toBe('Transaction saved. Budget updated.');
    expect(useScanStore.getState().receipt).toBeNull();
  });

  it('blocks saving when the items and total disagree', async () => {
    await openReview();
    await fireEvent.changeText(screen.getByLabelText('Receipt total in pesos'), '150.00');
    expect(
      await screen.findByText("The items don't add up to the receipt total."),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Save receipt' }));

    expect(
      await screen.findByText('Items come to ₱140.00 but the total is ₱150.00.'),
    ).toBeOnTheScreen();
    expect(api.calls('POST', `${RECEIPTS}/${RID}/confirm`)).toHaveLength(0);
  });

  it('shows server field errors next to the field', async () => {
    api.set(`POST ${RECEIPTS}/${RID}/confirm`, () =>
      problem(422, 'The request has invalid fields.', [
        { field: 'occurred_at', message: "Date can't be in the future.", code: 'value_error' },
      ]),
    );
    await openReview();
    await fireEvent.press(screen.getByRole('button', { name: 'Save receipt' }));

    expect(await screen.findByText("Date can't be in the future.")).toBeOnTheScreen();
    expect(useScanStore.getState().receipt).not.toBeNull();
  });

  it('warns about a likely duplicate', async () => {
    await openReview(receipt({
        possible_duplicate: { ...txn({ amount: '140.00', merchant: 'ZZ Mart' }), source: 'manual' },
      }));
    expect(screen.getByText(/You already have ₱140.00 at ZZ Mart on this day/)).toBeOnTheScreen();
  });

  it('discards the draft and its photo on cancel', async () => {
    api.set(`DELETE ${RECEIPTS}/${RID}`, () => reply(204));
    await openReview();

    await fireEvent.press(screen.getByRole('button', { name: 'Cancel scan' }));
    expect(await screen.findByText('Discard this scan?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(api.calls('DELETE', `${RECEIPTS}/${RID}`)).toHaveLength(1));
    expect(api.calls('POST', `${RECEIPTS}/${RID}/confirm`)).toHaveLength(0);
    expect(useScanStore.getState().receipt).toBeNull();
  });

  it('asks before discarding when the Android back button is pressed', async () => {
    await openReview();

    await pressHardwareBack();

    expect(await screen.findByText('Discard this scan?')).toBeOnTheScreen();
    expect(api.calls('DELETE', `${RECEIPTS}/${RID}`)).toHaveLength(0);
    expect(useScanStore.getState().receipt).not.toBeNull();
  });
});

describe('Scan failed', () => {
  it('discards the failed receipt and clears the scan on Android back', async () => {
    const failed = failedReceipt();
    api.set(`DELETE ${RECEIPTS}/${failed.id}`, () => reply(204));
    useScanStore.getState().setReceipt(failed);
    const router = await renderRouter(appDir, { initialUrl: '/scan/failed' });
    expect(
      await screen.findByRole('button', { name: 'Try scanning again' }, { timeout: 4000 }),
    ).toBeOnTheScreen();

    await pressHardwareBack();

    await waitFor(() => expect(router.getPathname()).toBe('/home'));
    await waitFor(() => expect(api.calls('DELETE', `${RECEIPTS}/${failed.id}`)).toHaveLength(1));
    expect(useScanStore.getState().receipt).toBeNull();
    expect(useScanStore.getState().photo).toBeNull();
  });

  it('discards the failed receipt and opens the manual form', async () => {
    const failed = failedReceipt();
    api.set(`DELETE ${RECEIPTS}/${failed.id}`, () => reply(204));
    useScanStore.getState().setReceipt(failed);
    const router = await renderRouter(appDir, { initialUrl: '/scan/failed' });

    expect(
      await screen.findByText(
        'The text was too unclear to pull out the items and total. Nothing was saved.',
        {},
        { timeout: 4000 },
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try scanning again' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Choose another image' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Enter the expense manually' }));

    await waitFor(() => expect(router.getPathname()).toBe('/expense-form'));
    expect(api.calls('DELETE', `${RECEIPTS}/${failed.id}`)).toHaveLength(1);
  });

  it('choosing another image goes back to the photo preview', async () => {
    useScanStore.getState().setReceipt(failedReceipt());
    camera.pickerResult = {
      canceled: false,
      assets: [{ uri: 'file:///photos/other.jpg', mimeType: 'image/jpeg' }],
    };
    const router = await renderRouter(appDir, { initialUrl: '/scan/failed' });

    await fireEvent.press(
      await screen.findByRole('button', { name: 'Choose another image' }, { timeout: 4000 }),
    );

    expect(await screen.findByRole('button', { name: 'Use photo' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/scan/camera');
    expect(useScanStore.getState().photo?.uri).toBe('file:///photos/other.jpg');
  });
});
