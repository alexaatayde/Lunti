/** TanStack Query hooks for the step 2 endpoints (AGENTS.md §8: all server data via src/api). */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { File } from 'expo-file-system';

import { api, postForm, unwrap } from './client';
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
export function invalidateMoney(client: ReturnType<typeof useQueryClient>) {
  return Promise.all(
    [['transactions'], ['budgets'], ['analytics'], ['patterns']].map((queryKey) =>
      client.invalidateQueries({ queryKey }),
    ),
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

export function useCreateTransaction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: TransactionCreate) =>
      unwrap(() => api.POST('/api/v1/transactions', { body })),
    onSuccess: () => invalidateMoney(client),
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
    onSuccess: (_data, id) => {
      client.removeQueries({ queryKey: moneyKeys.transaction(id) });
      return invalidateMoney(client);
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
