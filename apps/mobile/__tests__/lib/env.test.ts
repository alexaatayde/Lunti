/** Phase 8D.1: runtime environment (src/lib/env.ts): variant, environment label, release guard. */
import { resolveVariant, versionText } from '../../src/lib/env';

describe('resolveVariant', () => {
  it('uses the variant app.config.ts stamped into the build', () => {
    expect(resolveVariant('preview', false)).toBe('preview');
    expect(resolveVariant('development', false)).toBe('development');
  });

  it('fails closed: an optimized bundle without a variant is treated as production', () => {
    expect(resolveVariant(undefined, false)).toBe('production');
    expect(resolveVariant('staging', false)).toBe('production');
    expect(resolveVariant(undefined, true)).toBe('development');
  });
});

describe('versionText', () => {
  it('names the environment for non-production builds', () => {
    expect(versionText('1.0.0', 'Development')).toBe('1.0.0 · Development build');
    expect(versionText('1.0.0', 'Preview')).toBe('1.0.0 · Preview build');
    expect(versionText('1.0.0', null)).toBe('1.0.0');
  });
});

describe('release guard at startup', () => {
  const KEYS = ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

  afterEach(() => {
    jest.resetModules();
    jest.dontMock('expo-constants');
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function load(variant: string, env: Record<string, string>) {
    Object.assign(process.env, env);
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { version: '1.0.0', extra: { appVariant: variant } } },
    }));
    let mod!: typeof import('../../src/lib/env');
    jest.isolateModules(() => {
      mod = require('../../src/lib/env');
    });
    return mod;
  }

  const publicSupabase = {
    EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_test',
  };

  it('a production bundle pointing at the emulator API reports problems (app shows setup screen)', () => {
    const mod = load('production', { ...publicSupabase, EXPO_PUBLIC_API_URL: 'http://10.0.2.2:8000/api/v1' });
    expect(mod.appVariant).toBe('production');
    expect(mod.environmentLabel).toBeNull();
    expect(mod.configProblems.join(' ')).toMatch(/local address \(10\.0\.2\.2\)/);
  });

  it('a correctly configured preview bundle has no problems and is labelled', () => {
    const mod = load('preview', { ...publicSupabase, EXPO_PUBLIC_API_URL: 'https://api.lunti.example/api/v1' });
    expect(mod.configProblems).toEqual([]);
    expect(mod.environmentLabel).toBe('Preview');
    expect(mod.versionText()).toBe('1.0.0 · Preview build');
  });

  it('a development bundle may use the emulator API', () => {
    const mod = load('development', { ...publicSupabase, EXPO_PUBLIC_API_URL: 'http://10.0.2.2:8000/api/v1' });
    expect(mod.configProblems).toEqual([]);
  });

  it('missing Supabase values are listed by name only, not twice', () => {
    for (const k of KEYS) delete process.env[k];
    const mod = load('production', { EXPO_PUBLIC_API_URL: 'https://api.lunti.example/api/v1' });
    expect(mod.missingSupabaseEnv).toEqual(['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']);
    expect(mod.configProblems).toEqual([]);
  });

  it('supabase.ts creates no client when the config is unsafe', () => {
    load('production', { ...publicSupabase, EXPO_PUBLIC_API_URL: 'http://localhost:8000' });
    jest.doMock('@react-native-async-storage/async-storage', () =>
      require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
    );
    let supa!: typeof import('../../src/lib/supabase');
    jest.isolateModules(() => {
      supa = require('../../src/lib/supabase');
    });
    expect(supa.isSupabaseConfigured).toBe(false);
    expect(supa.supabase).toBeNull();
  });
});
