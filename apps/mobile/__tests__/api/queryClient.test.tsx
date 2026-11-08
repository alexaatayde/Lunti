import { act, renderHook } from '@testing-library/react-native';

import { queryClient, useResetQueriesOnUserChange } from '../../src/api/queryClient';
import { useSessionStore } from '../../src/stores/session';
import { fakeSession } from '../../test-utils/fakeSupabase';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);

const signIn = async (id: string) => {
  const session = fakeSession();
  session.user.id = id;
  await act(async () => useSessionStore.setState({ status: 'signedIn', session }));
};

beforeEach(() => {
  useSessionStore.setState({ status: 'loading', session: null });
  queryClient.clear();
});

describe('useResetQueriesOnUserChange', () => {
  it('keeps queries when the saved session is restored at startup', async () => {
    // renderHook is async in RNTL 14: the hook must be mounted before the session changes.
    await renderHook(() => useResetQueriesOnUserChange());
    // The first screen has already started its queries when the session arrives.
    queryClient.setQueryData(['budgets', 'status'], []);

    await signIn('user-a');

    // Clearing here orphaned Home's queries on a cold start (stuck loading forever).
    expect(queryClient.getQueryData(['budgets', 'status'])).toEqual([]);
  });

  it('clears everything on sign-out and when another account signs in', async () => {
    // renderHook is async in RNTL 14: the hook must be mounted before the session changes.
    await renderHook(() => useResetQueriesOnUserChange());
    await signIn('user-a');

    queryClient.setQueryData(['me'], { full_name: 'A' });
    await signIn('user-b');
    expect(queryClient.getQueryData(['me'])).toBeUndefined();

    queryClient.setQueryData(['me'], { full_name: 'B' });
    await act(async () => useSessionStore.setState({ status: 'signedOut', session: null }));
    expect(queryClient.getQueryData(['me'])).toBeUndefined();
  });
});
