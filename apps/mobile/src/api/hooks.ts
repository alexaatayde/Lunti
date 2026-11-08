/** TanStack Query hooks for the step 2 endpoints (AGENTS.md §8: all server data via src/api). */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from './client';
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
