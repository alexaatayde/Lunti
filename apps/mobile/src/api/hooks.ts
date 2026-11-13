/** TanStack Query hooks for the step 2 endpoints (AGENTS.md §8: all server data via src/api). */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { File } from 'expo-file-system';

import { api, ApiError, postForm, unwrap } from './client';
import type { components } from './schema';

export type Me = components['schemas']['Me'];
export type Preferences = components['schemas']['Preferences'];
export type Category = components['schemas']['Category'];

export const queryKeys = {
  me: ['me'] as const,
  preferences: ['me', 'preferences'] as const,
  categories: ['categories'] as const,
};

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: () => unwrap(() => api.GET('/api/v1/me')) });
}

export function usePreferences() {
  return useQuery({
    queryKey: queryKeys.preferences,
    queryFn: () => unwrap(() => api.GET('/api/v1/me/preferences')),
  });
}

export function useUpdatePreferences() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Preferences) => unwrap(() => api.PUT('/api/v1/me/preferences', { body })),
    onSuccess: (saved) => client.setQueryData(queryKeys.preferences, saved),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => unwrap(() => api.GET('/api/v1/categories')),
  });
}

// ---------- transactions & budgets (build step 3) ----------

export type Transaction = components['schemas']['Transaction'];
export type TransactionDetail = components['schemas']['TransactionDetail'];
export type TransactionSaved = components['schemas']['TransactionSaved'];
export type TransactionCreate = components['schemas']['TransactionCreate'];
export type TransactionUpdate = components['schemas']['TransactionUpdate'];
export type TransactionSummary = components['schemas']['TransactionSummary'];
export type BudgetAlert = components['schemas']['BudgetAlert'];
export type BudgetImpact = components['schemas']['BudgetImpact'];
export type Budget = components['schemas']['Budget'];
export type BudgetStatus = components['schemas']['BudgetStatus'];
export type BudgetCreate = components['schemas']['BudgetCreate'];
export type BudgetUpdate = components['schemas']['BudgetUpdate'];

/** Filters shared by the list and its summary. Dates are "YYYY-MM-DD" (Asia/Manila). */
export type TransactionFilters = {
  from?: string;
  to?: string;
  category_id?: string;
  q?: string;
};

const PAGE_SIZE = 30;

const cleanFilters = (filters: TransactionFilters) =>
  Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== ''),
  ) as TransactionFilters;

export const moneyKeys = {
  transactions: ['transactions'] as const,
  transactionList: (f: TransactionFilters) => ['transactions', 'list', cleanFilters(f)] as const,
  transactionSummary: (f: TransactionFilters) =>
    ['transactions', 'summary', cleanFilters(f)] as const,
  transaction: (id: string) => ['transactions', 'detail', id] as const,
  budgets: ['budgets'] as const,
  budgetStatus: ['budgets', 'status'] as const,
  budget: (id: string) => ['budgets', 'detail', id] as const,
};

/**
 * After any transaction or budget change, everything that shows money is refetched
 * (AGENTS.md §8: transactions, budgets, analytics, patterns).
 */
export function invalidateMoney(
  client: ReturnType<typeof useQueryClient>,
  options: { except?: readonly unknown[] } = {},
) {
  const { except } = options;
  const kept = except
    ? (query: { queryKey: readonly unknown[] }) =>
        !(
          query.queryKey.length === except.length &&
          query.queryKey.every((part, i) => part === except[i])
        )
    : undefined;
  return Promise.all(
    // Purchases also move restock suggestions, the list's budget check and budget alerts.
    [
      ['transactions'],
      ['budgets'],
      ['analytics'],
      ['patterns'],
      ['replenishment'],
      ['shopping-list'],
      ['notifications'],
      ['pantry'],
      ['recipes'],
      ['insights'],
    ].map((queryKey) => client.invalidateQueries({ queryKey, predicate: kept })),
  );
}

export function useTransactions(filters: TransactionFilters) {
  const query = cleanFilters(filters);
  return useInfiniteQuery({
    queryKey: moneyKeys.transactionList(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      unwrap(() =>
        api.GET('/api/v1/transactions', {
          params: { query: { ...query, limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    getNextPageParam: (last) => last.next_cursor ?? null,
  });
}

export function useTransactionSummary(filters: TransactionFilters) {
  const query = cleanFilters(filters);
  return useQuery({
    queryKey: moneyKeys.transactionSummary(filters),
    queryFn: () => unwrap(() => api.GET('/api/v1/transactions/summary', { params: { query } })),
  });
}

export function useTransaction(id: string | undefined) {
  return useQuery({
    queryKey: moneyKeys.transaction(id ?? ''),
    enabled: !!id,
    queryFn: () =>
      unwrap(() =>
        api.GET('/api/v1/transactions/{transaction_id}', {
          params: { path: { transaction_id: id! } },
        }),
      ),
  });
}

/** Problem type when an Idempotency-Key was already used for a different expense. */
export const KEY_REUSED = 'urn:lunti:problem:idempotency-key-reused';

export type CreateTransactionInput = {
  body: TransactionCreate;
  /**
   * One key per intended expense (a form, an Undo), reused for every attempt to save it. If a
   * save times out after the server recorded it, sending it again with the same key returns
   * that transaction instead of recording a second one. Never generate it inside a retry.
   */
  idempotencyKey: string;
};

/**
 * Not retried automatically: a failed save shows its error and the user taps Save again, which
 * reuses the same key, so a save that did reach the server is never doubled.
 */
export function useCreateTransaction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: CreateTransactionInput) => {
      // The API still accepts a create without a key (older clients); this app never sends one.
      if (!idempotencyKey) throw new Error('A transaction needs an idempotency key.');
      return unwrap(() =>
        api.POST('/api/v1/transactions', {
          body,
          params: { header: { 'Idempotency-Key': idempotencyKey } },
        }),
      );
    },
    onSuccess: () => invalidateMoney(client),
    onError: (error) => {
      // An earlier attempt was saved (or saved and deleted): show the list as it really is.
      if (
        error instanceof ApiError &&
        (error.problem?.type === KEY_REUSED || error.kind === 'conflict')
      ) {
        void invalidateMoney(client);
      }
    },
  });
}

export function useUpdateTransaction(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: TransactionUpdate) =>
      unwrap(() =>
        api.PATCH('/api/v1/transactions/{transaction_id}', {
          params: { path: { transaction_id: id } },
          body,
        }),
      ),
    onSuccess: () => invalidateMoney(client),
  });
}

export function useDeleteTransaction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(() =>
        api.DELETE('/api/v1/transactions/{transaction_id}', {
          params: { path: { transaction_id: id } },
        }),
      ),
    // The deleted transaction's own query is left alone: its screen is still open (closing
    // its dialog) when this runs. Removing or refetching it there would GET a 404 and swap the
    // screen to a loading state, unmounting the open dialog — which on Android leaves the
    // dialog's invisible window on top, swallowing every touch (the Undo toast included).
    // With no screen left watching it, the cache drops it on its own. The refetches run in
    // the background (not awaited), so the dialog closes as soon as the DELETE succeeds.
    onSuccess: (_data, id) => {
      void invalidateMoney(client, { except: moneyKeys.transaction(id) });
    },
  });
}

export function useBudgetStatus() {
  return useQuery({
    queryKey: moneyKeys.budgetStatus,
    queryFn: () => unwrap(() => api.GET('/api/v1/budgets/status')),
  });
}

export function useBudget(id: string | undefined) {
  return useQuery({
    queryKey: moneyKeys.budget(id ?? ''),
    enabled: !!id,
    queryFn: () =>
      unwrap(() =>
        api.GET('/api/v1/budgets/{budget_id}', { params: { path: { budget_id: id! } } }),
      ),
  });
}

export function useCreateBudget() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: BudgetCreate) => unwrap(() => api.POST('/api/v1/budgets', { body })),
    onSuccess: () => invalidateMoney(client),
  });
}

export function useUpdateBudget(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: BudgetUpdate) =>
      unwrap(() =>
        api.PATCH('/api/v1/budgets/{budget_id}', { params: { path: { budget_id: id } }, body }),
      ),
    onSuccess: () => invalidateMoney(client),
  });
}

export function useDeleteBudget() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(() =>
        api.DELETE('/api/v1/budgets/{budget_id}', { params: { path: { budget_id: id } } }),
      ),
    onSuccess: () => invalidateMoney(client),
  });
}

// ---------- receipts (build step 4) ----------

export type Receipt = components['schemas']['Receipt'];
export type ReceiptConfirm = components['schemas']['ReceiptConfirm'];
export type ReceiptConfirmed = components['schemas']['ReceiptConfirmed'];
export type ReceiptFlag = components['schemas']['ReviewFlag'];

export type ReceiptPhoto = {
  uri: string;
  /** "image/jpeg" | "image/png" | "image/webp"; the server checks the bytes anyway. */
  mimeType: string;
  fileName: string;
};

/**
 * Upload a receipt photo and read it. `uploadId` is generated once per photo: resending it
 * (after a timeout or a dropped connection) returns the same receipt instead of a new one.
 */
export function uploadReceipt(photo: ReceiptPhoto, uploadId: string) {
  return postForm<Receipt>('/api/v1/receipts', () => {
    const form = new FormData();
    form.append('client_id', uploadId);
    // Expo's fetch sends Blob-like parts; expo-file-system's File reads the photo's bytes
    // unchanged (no re-encoding).
    form.append('image', new File(photo.uri) as unknown as Blob, photo.fileName);
    return form;
  }).then((result) => result.data);
}

export function useUploadReceipt() {
  return useMutation({
    mutationFn: ({ photo, uploadId }: { photo: ReceiptPhoto; uploadId: string }) =>
      uploadReceipt(photo, uploadId),
  });
}

/** Saves the checked receipt as a transaction. Safe to retry: the server returns the same one. */
export function useConfirmReceipt(receiptId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ReceiptConfirm) =>
      unwrap(() =>
        api.POST('/api/v1/receipts/{receipt_id}/confirm', {
          params: { path: { receipt_id: receiptId } },
          body,
        }),
      ),
    onSuccess: () => invalidateMoney(client),
  });
}

/** Deletes an unconfirmed receipt and its photo (cancel, retake, leaving a failed scan). */
export function discardReceipt(receiptId: string) {
  return unwrap(() =>
    api.DELETE('/api/v1/receipts/{receipt_id}', {
      params: { path: { receipt_id: receiptId } },
    }),
  );
}

// ---------- analytics (build step 5) ----------

export type AnalyticsPeriod = 'daily' | 'weekly' | 'monthly';
export type AnalyticsSummary = components['schemas']['AnalyticsSummary'];
export type ProductPattern = components['schemas']['ProductPattern'];
export type CategoryTotal = components['schemas']['CategoryTotal'];

export const analyticsKeys = {
  summary: (period: AnalyticsPeriod) => ['analytics', 'summary', period] as const,
  patterns: ['patterns'] as const,
};

/** Spending so far this day/week/month vs the same span before (all sums by the API). */
export function useAnalyticsSummary(period: AnalyticsPeriod) {
  return useQuery({
    queryKey: analyticsKeys.summary(period),
    queryFn: () =>
      unwrap(() => api.GET('/api/v1/analytics/summary', { params: { query: { period } } })),
  });
}

export function usePurchasePatterns() {
  return useQuery({
    queryKey: analyticsKeys.patterns,
    queryFn: () => unwrap(() => api.GET('/api/v1/analytics/patterns')),
  });
}

// ---------- replenishment, shopping list, notifications (build step 6) ----------

export type Suggestion = components['schemas']['Suggestion'];
export type FeedbackAction = components['schemas']['SuggestionFeedback']['action'];
export type SuggestionFeedback = components['schemas']['SuggestionFeedback'];
export type ShoppingList = components['schemas']['ShoppingList'];
export type ShoppingListItem = components['schemas']['ShoppingListItem'];
export type ItemCreate = components['schemas']['ItemCreate'];
export type ItemUpdate = components['schemas']['ItemUpdate'];
export type AppNotification = components['schemas']['NotificationOut'];
export type MutedProduct = components['schemas']['MutedProduct'];
export type NotificationPage = components['schemas']['NotificationPage'];

export const step6Keys = {
  suggestions: ['replenishment', 'suggestions'] as const,
  shoppingList: ['shopping-list'] as const,
  notifications: ['notifications'] as const,
  muted: ['replenishment', 'muted'] as const,
};

/** After answering a suggestion or editing the list, these views change together. */
function invalidateLists(client: ReturnType<typeof useQueryClient>) {
  return Promise.all(
    [step6Keys.suggestions, step6Keys.shoppingList, step6Keys.notifications].map((queryKey) =>
      client.invalidateQueries({ queryKey }),
    ),
  );
}

export function useSuggestions() {
  return useQuery({
    queryKey: step6Keys.suggestions,
    queryFn: () => unwrap(() => api.GET('/api/v1/replenishment/suggestions')),
  });
}

export function useSuggestionFeedback() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SuggestionFeedback }) =>
      unwrap(() =>
        api.POST('/api/v1/replenishment/suggestions/{suggestion_id}/feedback', {
          params: { path: { suggestion_id: id } },
          body,
        }),
      ),
    onSuccess: () =>
      Promise.all([
        invalidateLists(client),
        client.invalidateQueries({ queryKey: step6Keys.muted }),
      ]),
  });
}

/** The user's one grocery list (the API creates it on first use). */
export function useShoppingList() {
  return useQuery({
    queryKey: step6Keys.shoppingList,
    queryFn: () => unwrap(() => api.GET('/api/v1/shopping-lists')).then((lists) => lists[0]),
  });
}

export function useAddListItem(listId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ItemCreate) =>
      unwrap(() =>
        api.POST('/api/v1/shopping-lists/{list_id}/items', {
          params: { path: { list_id: listId ?? '' } },
          body,
        }),
      ),
    onSuccess: () => invalidateLists(client),
  });
}

export function useUpdateListItem(listId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ItemUpdate }) =>
      unwrap(() =>
        api.PATCH('/api/v1/shopping-lists/{list_id}/items/{item_id}', {
          params: { path: { list_id: listId ?? '', item_id: id } },
          body,
        }),
      ),
    onSuccess: () => invalidateLists(client),
  });
}

export function useDeleteListItem(listId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(() =>
        api.DELETE('/api/v1/shopping-lists/{list_id}/items/{item_id}', {
          params: { path: { list_id: listId ?? '', item_id: id } },
        }),
      ),
    onSuccess: () => invalidateLists(client),
  });
}

export function useMutedProducts() {
  return useQuery({
    queryKey: step6Keys.muted,
    queryFn: () => unwrap(() => api.GET('/api/v1/replenishment/muted')),
  });
}

/** Turns reminders back on (also the Undo for "Don't remind"). */
export function unmuteProduct(productId: string) {
  return unwrap(() =>
    api.DELETE('/api/v1/replenishment/muted/{product_id}', {
      params: { path: { product_id: productId } },
    }),
  );
}

export function useUnmuteProduct() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: unmuteProduct,
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['replenishment'] }),
        client.invalidateQueries({ queryKey: step6Keys.notifications }),
      ]),
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: step6Keys.notifications,
    queryFn: () => unwrap(() => api.GET('/api/v1/notifications')),
  });
}

export function useMarkNotificationRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(() =>
        api.POST('/api/v1/notifications/{notification_id}/read', {
          params: { path: { notification_id: id } },
        }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: step6Keys.notifications }),
  });
}

export function useMarkAllNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(() => api.POST('/api/v1/notifications/read-all')),
    onSuccess: () => client.invalidateQueries({ queryKey: step6Keys.notifications }),
  });
}

export function registerDevice(fcmToken: string, platform: 'android' | 'ios') {
  return unwrap(() => api.POST('/api/v1/devices', { body: { fcm_token: fcmToken, platform } }));
}

export function unregisterDevice(fcmToken: string) {
  return unwrap(() =>
    api.DELETE('/api/v1/devices/{fcm_token}', { params: { path: { fcm_token: fcmToken } } }),
  );
}

// ---------- pantry, recipes, insights (build step 7) ----------

export type PantryPage = components['schemas']['PantryPage'];
export type PantryItem = components['schemas']['PantryItem'];
export type PantryUpdate = components['schemas']['PantryUpdate'];
export type Recommendations = components['schemas']['Recommendations'];
export type RecipeSummary = components['schemas']['RecipeSummary'];
export type RecipeDetail = components['schemas']['RecipeDetail'];
export type Ingredient = components['schemas']['IngredientOut'];
export type InsightsPage = components['schemas']['InsightsPage'];
export type Insight = components['schemas']['InsightOut'];

export const step7Keys = {
  pantry: ['pantry'] as const,
  recommendations: ['recipes', 'recommendations'] as const,
  recipe: (id: string) => ['recipes', 'detail', id] as const,
  insights: ['insights'] as const,
};

export function usePantry() {
  return useQuery({
    queryKey: step7Keys.pantry,
    queryFn: () => unwrap(() => api.GET('/api/v1/pantry')),
  });
}

/** Pantry amounts drive recipe matches, so both refresh after a change. */
export function useUpdatePantryItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PantryUpdate }) =>
      unwrap(() =>
        api.PATCH('/api/v1/pantry/{item_id}', { params: { path: { item_id: id } }, body }),
      ),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: step7Keys.pantry }),
        client.invalidateQueries({ queryKey: ['recipes'] }),
      ]),
  });
}

export function useRecommendations() {
  return useQuery({
    queryKey: step7Keys.recommendations,
    queryFn: () => unwrap(() => api.GET('/api/v1/recipes/recommendations')),
  });
}

export function useRecipe(id: string | undefined) {
  return useQuery({
    queryKey: step7Keys.recipe(id ?? ''),
    enabled: !!id,
    queryFn: () =>
      unwrap(() => api.GET('/api/v1/recipes/{recipe_id}', { params: { path: { recipe_id: id ?? '' } } })),
  });
}

export function useAddMissingToList() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (recipeId: string) =>
      unwrap(() =>
        api.POST('/api/v1/recipes/{recipe_id}/add-missing', {
          params: { path: { recipe_id: recipeId } },
        }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: step6Keys.shoppingList }),
  });
}

export function useInsights() {
  return useQuery({
    queryKey: step7Keys.insights,
    queryFn: () => unwrap(() => api.GET('/api/v1/insights')),
  });
}

export function useDismissInsight() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(() =>
        api.POST('/api/v1/insights/{insight_id}/dismiss', { params: { path: { insight_id: id } } }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: step7Keys.insights }),
  });
}
