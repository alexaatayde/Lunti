import { AuthApiError } from '@supabase/supabase-js';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { useSessionStore } from '../../src/stores/session';
import {
  fakeAuth,
  fakeSession,
  resetFakeSupabase,
  setFakeSession,
} from '../../test-utils/fakeSupabase';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);

const appDir = './app';
const TERMS = 'I agree to the Terms of Use and Privacy Notice.';
const DATA_CONSENT =
  'I consent to Lunti processing my receipts and spending data to give me budgets and suggestions, as required by the Data Privacy Act of 2012.';

beforeEach(() => {
  useSessionStore.setState({ status: 'loading', session: null });
  resetFakeSupabase(null);
});

async function fillForm({
  password = 'leafygreens24',
  confirm = password,
  consents = true,
}: { password?: string; confirm?: string; consents?: boolean } = {}) {
  await fireEvent.changeText(screen.getByLabelText('Full name'), ' Alex Reyes ');
  await fireEvent.changeText(screen.getByLabelText('Email'), 'alex@example.com');
  await fireEvent.changeText(screen.getByLabelText('Password'), password);
  await fireEvent.changeText(screen.getByLabelText('Confirm password'), confirm);
  if (consents) {
    await fireEvent.press(screen.getByRole('checkbox', { name: TERMS }));
    await fireEvent.press(screen.getByRole('checkbox', { name: DATA_CONSENT }));
  }
}

const submit = () => fireEvent.press(screen.getByRole('button', { name: 'Create account' }));

describe('Sign up', () => {
  it('requires both consents (RA 10173)', async () => {
    await renderRouter(appDir, { initialUrl: '/sign-up' });

    await fillForm({ consents: false });
    await submit();

    expect(
      await screen.findByText('Accept the Terms of Use and Privacy Notice to continue.'),
    ).toBeOnTheScreen();
    expect(fakeAuth.signUp).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('checkbox', { name: TERMS }));
    await submit();
    expect(await screen.findByText('Consent to data processing to continue.')).toBeOnTheScreen();
    expect(fakeAuth.signUp).not.toHaveBeenCalled();
  });

  it('enforces the password rule and matching confirmation', async () => {
    await renderRouter(appDir, { initialUrl: '/sign-up' });

    await fillForm({ password: 'leafygreens', confirm: 'leafygreen' });
    await submit();

    expect(await screen.findByText('Add at least one number.')).toBeOnTheScreen();
    expect(screen.getByText("Passwords don't match.")).toBeOnTheScreen();
    expect(fakeAuth.signUp).not.toHaveBeenCalled();
  });

  it('shows password strength and a match tick', async () => {
    await renderRouter(appDir, { initialUrl: '/sign-up' });

    await fillForm({ consents: false });

    expect(screen.getByText(/Good password/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Passwords match')).toBeOnTheScreen();
  });

  it('creates the account with both consents recorded and opens Home', async () => {
    fakeAuth.signUp.mockImplementation(async () => {
      const session = fakeSession();
      setFakeSession(session);
      return { data: { user: session.user, session }, error: null };
    });
    const router = await renderRouter(appDir, { initialUrl: '/sign-up' });

    await fillForm();
    await submit();

    await waitFor(() => expect(router.getPathname()).toBe('/home'));
    const call = fakeAuth.signUp.mock.calls[0][0];
    expect(call.email).toBe('alex@example.com');
    expect(call.password).toBe('leafygreens24');
    expect(call.options.data.full_name).toBe('Alex Reyes');
    expect(Date.parse(call.options.data.terms_accepted_at)).not.toBeNaN();
    expect(Date.parse(call.options.data.data_consent_at)).not.toBeNaN();
  });

  it('asks the user to confirm their email when the project requires it', async () => {
    fakeAuth.signUp.mockResolvedValue({
      data: { user: fakeSession().user, session: null },
      error: null,
    });
    const router = await renderRouter(appDir, { initialUrl: '/sign-up' });

    await fillForm();
    await submit();

    expect(await screen.findByText('Check your email')).toBeOnTheScreen();
    expect(screen.getByText('alex@example.com')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Go to sign in' }));
    expect(router.getPathname()).toBe('/sign-in');
  });

  it('explains when the email is already registered', async () => {
    fakeAuth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError('User already registered', 422, 'user_already_exists'),
    });
    const router = await renderRouter(appDir, { initialUrl: '/sign-up' });

    await fillForm();
    await submit();

    expect(
      await screen.findByText('An account with this email already exists. Try signing in.'),
    ).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/sign-up');
  });
});
