/** Loads the real src/lib/supabase (not the fake) to check how it reads .env. */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const ENV_KEYS = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function load(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  let mod!: typeof import('../../src/lib/supabase');
  jest.isolateModules(() => {
    mod = require('../../src/lib/supabase');
  });
  return mod;
}

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('supabase client setup', () => {
  it('does not create a client and lists what is missing when .env is empty', () => {
    const mod = load({});

    expect(mod.supabase).toBeNull();
    expect(mod.isSupabaseConfigured).toBe(false);
    expect(mod.missingSupabaseEnv).toEqual(ENV_KEYS);
  });

  it('creates an auth client when both values are set', () => {
    const mod = load({
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'public-anon-key',
    });

    expect(mod.isSupabaseConfigured).toBe(true);
    expect(mod.supabase?.auth).toBeDefined();
  });
});
