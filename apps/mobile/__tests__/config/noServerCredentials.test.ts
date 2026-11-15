/**
 * Server credentials must never be part of the mobile project (Phase 8D.4a, AGENTS.md §4.7):
 * everything under apps/mobile can end up in a bundle or an EAS build upload. Google Vision
 * and Firebase Admin service-account keys, PEM private keys and Supabase secret keys live
 * only in the backend environment, outside the repository.
 *
 * (google-services.json, the Firebase *client* config, is public by design and not checked
 * here; the EXPO_PUBLIC_* variables are checked by buildEnv.)
 */
type Stat = { isDirectory(): boolean; isFile(): boolean; size: number };
const fs = jest.requireActual<{
  readdirSync(dir: string): string[];
  statSync(path: string): Stat;
  readFileSync(path: string, encoding: 'utf8'): string;
}>('fs');

const ROOT = process.cwd(); // jest runs from apps/mobile
const SKIP_DIRS = new Set(['node_modules', '.expo', 'android', 'ios', 'dist', 'web-build', '.git']);
const MAX_BYTES = 2 * 1024 * 1024;

const CREDENTIAL_NAME =
  /(service[-_]?account|-adminsdk-|vision-key|gcp-.*key|google-credentials|client_secret).*\.json$/i;

function credentialKind(text: string): string | null {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]{40,}?-----END [A-Z ]*PRIVATE KEY-----/.test(text)) {
    return 'a PEM private key';
  }
  if (/"type"\s*:\s*"service_account"/.test(text) && /"private_key"\s*:/.test(text)) {
    return 'a Google service-account key';
  }
  if (/sb_secret_[A-Za-z0-9_-]{20,}/.test(text)) return 'a Supabase secret key';
  return null;
}

function* files(dir: string): Generator<string> {
  for (const name of fs.readdirSync(dir)) {
    const path = `${dir}/${name}`;
    const info = fs.statSync(path);
    if (info.isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* files(path);
    } else if (info.isFile() && info.size <= MAX_BYTES) {
      yield path;
    }
  }
}

describe('no server credentials in the mobile project', () => {
  it('has no credential files or key material', () => {
    const problems: string[] = [];
    for (const path of files(ROOT)) {
      const name = path.slice(ROOT.length + 1);
      if (CREDENTIAL_NAME.test(name)) problems.push(`${name}: credential file name`);
      const kind = credentialKind(fs.readFileSync(path, 'utf8'));
      if (kind) problems.push(`${name}: contains ${kind}`);
    }
    expect(problems).toEqual([]);
  });

  it('recognises real key shapes but not the rule definitions', () => {
    const pem = `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(64)}\n-----END PRIVATE KEY-----`;
    expect(credentialKind(pem)).toBe('a PEM private key');
    expect(credentialKind(JSON.stringify({ type: 'service_account', private_key: 'x' }))).toBe(
      'a Google service-account key',
    );
    expect(credentialKind(`key=sb_secret_${'a'.repeat(24)}`)).toBe('a Supabase secret key');
    // What buildEnv and its tests contain: names and fragments, not keys.
    expect(credentialKind('-----BEGIN PRIVATE KEY-----')).toBeNull();
    expect(credentialKind('{"type": "service_account"}')).toBeNull();
    expect(credentialKind("'sb_secret_abc'")).toBeNull();
    expect(CREDENTIAL_NAME.test('lunti-firebase-adminsdk-ab12c-0123456789.json')).toBe(true);
    expect(CREDENTIAL_NAME.test('google-services.json')).toBe(false);
  });
});
