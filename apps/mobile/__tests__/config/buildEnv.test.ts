/** Phase 8D.1: build variants and the public-config safety rules (src/config/buildEnv.ts). */
import {
  VARIANT_IDENTITY,
  buildEnvProblems,
  isLocalHost,
  jwtRole,
  leakedSecretProblems,
  parseVariant,
  publicConfigProblems,
} from '../../src/config/buildEnv';

/** A JWT-shaped string with the given payload (signature irrelevant: only the claim is read). */
function fakeJwt(payload: object): string {
  const b64 = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

const SAFE = {
  EXPO_PUBLIC_API_URL: 'https://api.lunti.example/api/v1',
  EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: fakeJwt({ role: 'anon', iss: 'supabase' }),
};

describe('variants', () => {
  it('defaults to development when APP_VARIANT is unset (local runs, Expo Go)', () => {
    expect(parseVariant(undefined)).toBe('development');
    expect(parseVariant('  ')).toBe('development');
  });

  it('rejects an unknown variant instead of guessing', () => {
    expect(() => parseVariant('staging')).toThrow(/APP_VARIANT must be one of/);
  });

  it('gives each variant its own package and link scheme so they install side by side', () => {
    const ids = Object.values(VARIANT_IDENTITY);
    expect(new Set(ids.map((i) => i.androidPackage)).size).toBe(3);
    expect(new Set(ids.map((i) => i.scheme)).size).toBe(3);
    expect(VARIANT_IDENTITY.production).toMatchObject({
      name: 'Lunti',
      androidPackage: 'ph.lunti.app',
      scheme: 'lunti',
      label: null,
    });
    expect(VARIANT_IDENTITY.development.label).toBe('Development');
    expect(VARIANT_IDENTITY.preview.label).toBe('Preview');
  });
});

describe('local addresses', () => {
  it.each([
    'localhost',
    '127.0.0.1',
    '10.0.2.2',
    '192.168.1.20',
    '172.16.0.4',
    '172.31.255.1',
    '169.254.1.1',
    '100.100.1.1',
    '0.0.0.0',
    '[::1]',
    'fe80::1',
    'fd12::1',
    'my-mac.local',
  ])('%s is local', (host) => {
    expect(isLocalHost(host)).toBe(true);
  });

  it.each(['api.lunti.example', 'abc.supabase.co', '8.8.8.8', '172.32.0.1', 'fcm.example.com', 'fd.example.com'])(
    '%s is not local',
    (host) => {
      expect(isLocalHost(host)).toBe(false);
    },
  );
});

describe('release builds (preview, production)', () => {
  it.each(['preview', 'production'] as const)('%s accepts explicit https public addresses', (variant) => {
    expect(buildEnvProblems(variant, SAFE)).toEqual([]);
  });

  it.each([
    ['http://10.0.2.2:8000/api/v1', /must use https.*local address \(10\.0\.2\.2\)/s],
    ['https://localhost/api/v1', /local address \(localhost\)/],
    ['http://api.lunti.example/api/v1', /must use https/],
    ['', /EXPO_PUBLIC_API_URL is not set/],
    ['not a url', /not a valid http\(s\) URL/],
  ])('refuses EXPO_PUBLIC_API_URL=%j in production', (apiUrl, expected) => {
    const problems = buildEnvProblems('production', { ...SAFE, EXPO_PUBLIC_API_URL: apiUrl });
    expect(problems.join(' ')).toMatch(expected);
  });

  it('never falls back to a default address when the API URL is missing', () => {
    const { EXPO_PUBLIC_API_URL: _omit, ...rest } = SAFE;
    expect(buildEnvProblems('preview', rest)).toEqual([
      'EXPO_PUBLIC_API_URL is not set. Release builds need an explicit address.',
    ]);
  });

  it('requires the Supabase values too', () => {
    expect(buildEnvProblems('production', { EXPO_PUBLIC_API_URL: SAFE.EXPO_PUBLIC_API_URL })).toEqual([
      'EXPO_PUBLIC_SUPABASE_URL is not set. Release builds need an explicit address.',
      'EXPO_PUBLIC_SUPABASE_ANON_KEY is not set.',
    ]);
  });
});

describe('development builds', () => {
  it('may use the emulator host or a LAN address over http', () => {
    expect(
      buildEnvProblems('development', { ...SAFE, EXPO_PUBLIC_API_URL: 'http://10.0.2.2:8000/api/v1' }),
    ).toEqual([]);
    expect(
      buildEnvProblems('development', { ...SAFE, EXPO_PUBLIC_API_URL: 'http://192.168.1.5:8000/api/v1' }),
    ).toEqual([]);
  });

  it('tolerates empty values (the app shows its setup screen instead)', () => {
    expect(buildEnvProblems('development', {})).toEqual([]);
  });
});

describe('secrets never enter the bundle (all variants)', () => {
  it('reads the role claim of a Supabase JWT key', () => {
    expect(jwtRole(fakeJwt({ role: 'anon' }))).toBe('anon');
    expect(jwtRole(fakeJwt({ role: 'service_role' }))).toBe('service_role');
    expect(jwtRole('sb_publishable_abc')).toBeNull();
    expect(jwtRole('a.b.c')).toBeNull();
  });

  it.each(['development', 'preview', 'production'] as const)(
    'refuses the service-role key as the anon key in %s',
    (variant) => {
      const problems = buildEnvProblems(variant, {
        ...SAFE,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: fakeJwt({ role: 'service_role' }),
      });
      expect(problems.join(' ')).toMatch(/service-role key/);
      expect(problems.join(' ')).toMatch(/"service_role" key/);
    },
  );

  it('accepts the new publishable key format', () => {
    expect(
      buildEnvProblems('production', { ...SAFE, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_abc123' }),
    ).toEqual([]);
  });

  it.each([
    'EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY',
    'EXPO_PUBLIC_OPENAI_API_KEY',
    'EXPO_PUBLIC_GOOGLE_APPLICATION_CREDENTIALS',
    'EXPO_PUBLIC_FCM_CREDENTIALS',
    'EXPO_PUBLIC_SUPABASE_JWT_SECRET',
    'EXPO_PUBLIC_DATABASE_URL',
  ])('refuses a variable named %s', (name) => {
    expect(leakedSecretProblems({ [name]: 'x' })).toEqual([
      `${name} looks like a server secret and must not be an EXPO_PUBLIC_ variable.`,
    ]);
  });

  it.each([
    ['sb_secret_abc', 'a Supabase secret key'],
    ['sk-proj-abcdefghijklmnop', 'an OpenAI API key'],
    ['-----BEGIN PRIVATE KEY-----', 'a private key'],
    ['{"type": "service_account"}', 'a Google service-account credential'],
    ['postgresql://u:p@db/x', 'a database connection string'],
  ])('refuses secret values under innocent names (%s)', (value, kind) => {
    expect(leakedSecretProblems({ EXPO_PUBLIC_EXTRA: value })).toEqual([
      `EXPO_PUBLIC_EXTRA contains ${kind}; it would be readable by anyone with the app.`,
    ]);
  });

  it('ignores server variables that are not EXPO_PUBLIC_ (they are never bundled)', () => {
    expect(leakedSecretProblems({ SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x', OPENAI_API_KEY: 'sk-abcdefghijklmn' })).toEqual([]);
  });

  it('publicConfigProblems checks only the three public values', () => {
    expect(
      publicConfigProblems('production', {
        apiUrl: SAFE.EXPO_PUBLIC_API_URL,
        supabaseUrl: SAFE.EXPO_PUBLIC_SUPABASE_URL,
        supabaseAnonKey: SAFE.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      }),
    ).toEqual([]);
  });
});
