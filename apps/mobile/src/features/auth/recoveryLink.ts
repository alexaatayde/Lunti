/**
 * Reads what the password-reset email link brought back to the app. Supabase redirects to
 * lunti://reset-password?code=… on success, or with error / error_code / error_description
 * (in the query or the fragment) when the link is expired, already used or invalid.
 *
 * Never log these values: the code is a one-time credential.
 */
export type RecoveryLink =
  | { kind: 'code'; code: string }
  | { kind: 'error'; reason: 'expired' }
  | { kind: 'none' };

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

/** Error parameters Supabase may put in the URL fragment instead of the query. */
export function fragmentParams(url: string | null | undefined): Params {
  const hash = url?.split('#')[1];
  if (!hash) return {};
  const params: Params = {};
  for (const [key, value] of new URLSearchParams(hash)) params[key] = value;
  return params;
}

export function parseRecoveryLink(query: Params, fragment: Params = {}): RecoveryLink {
  const all = { ...fragment, ...query };
  if (first(all.error) || first(all.error_code) || first(all.error_description)) {
    return { kind: 'error', reason: 'expired' };
  }
  const code = first(all.code);
  // Supabase codes are UUIDs; refuse anything else instead of sending it to the server.
  if (code && /^[0-9a-f-]{20,64}$/i.test(code)) return { kind: 'code', code };
  if (code) return { kind: 'error', reason: 'expired' };
  return { kind: 'none' };
}
