/**
 * Phase 8D.1: app.config.ts + eas.json. Evaluates the real config the way Expo/EAS does, with
 * the environment of each build profile, so a release build can never be configured against a
 * local server or with a server secret in its bundle.
 */
import type { ExpoConfig } from 'expo/config';

// No @types/node in this project: take just what is needed from Node's fs.
const fs = jest.requireActual<{ readFileSync(file: string, encoding: 'utf8'): string }>('fs');
/** apps/mobile, from this test file's path. */
const ROOT = (expect.getState().testPath ?? '').replace(/[\\/]__tests__[\\/].*$/, '');
const read = (name: string) => fs.readFileSync(`${ROOT}/${name}`, 'utf8');

const appJson = JSON.parse(read('app.json')) as { expo: ExpoConfig };
const easJson = JSON.parse(read('eas.json'));

const SAFE_RELEASE = {
  EXPO_PUBLIC_API_URL: 'https://api.lunti.example/api/v1',
  EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_test',
};

const MANAGED = ['APP_VARIANT', ...Object.keys(SAFE_RELEASE)];
const saved = Object.fromEntries(MANAGED.map((k) => [k, process.env[k]]));
const initialKeys = new Set(Object.keys(process.env));

function evaluate(env: Record<string, string>): ExpoConfig {
  for (const key of MANAGED) delete process.env[key];
  Object.assign(process.env, env);
  let config!: ExpoConfig;
  jest.isolateModules(() => {
    const factory = require('../../app.config').default;
    config = factory({ config: structuredClone(appJson.expo), projectRoot: ROOT } as never);
  });
  return config;
}

afterEach(() => {
  // Remove anything a test added (e.g. a secret-named variable), then restore the originals.
  for (const key of Object.keys(process.env)) {
    if (!initialKeys.has(key)) delete process.env[key];
  }
  for (const key of MANAGED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('app.config.ts', () => {
  it('configures a development build by default (local runs) and allows a local API', () => {
    const config = evaluate({ EXPO_PUBLIC_API_URL: 'http://10.0.2.2:8000/api/v1' });
    expect(config.name).toBe('Lunti Dev');
    expect(config.scheme).toBe('lunti-dev');
    expect(config.android?.package).toBe('ph.lunti.app.dev');
    expect(config.extra).toMatchObject({
      appVariant: 'development',
      environmentLabel: 'Development',
      releaseBuild: false,
    });
  });

  it.each([
    ['preview', 'Lunti Preview', 'ph.lunti.app.preview', 'lunti-preview'],
    ['production', 'Lunti', 'ph.lunti.app', 'lunti'],
  ])('configures %s with its own identity', (variant, name, pkg, scheme) => {
    const config = evaluate({ APP_VARIANT: variant, ...SAFE_RELEASE });
    expect(config).toMatchObject({ name, scheme, android: { package: pkg } });
    expect(config.extra).toMatchObject({ appVariant: variant, releaseBuild: true });
  });

  it('refuses to configure a production build that would use the emulator/localhost API', () => {
    expect(() =>
      evaluate({ ...SAFE_RELEASE, APP_VARIANT: 'production', EXPO_PUBLIC_API_URL: 'http://10.0.2.2:8000/api/v1' }),
    ).toThrow(/production build is not safely configured[\s\S]*local address \(10\.0\.2\.2\)/);
    expect(() =>
      evaluate({ ...SAFE_RELEASE, APP_VARIANT: 'preview', EXPO_PUBLIC_API_URL: 'http://localhost:8000' }),
    ).toThrow(/preview build is not safely configured/);
  });

  it('refuses a release build with no API URL instead of defaulting to one', () => {
    const { EXPO_PUBLIC_API_URL: _omit, ...rest } = SAFE_RELEASE;
    expect(() => evaluate({ APP_VARIANT: 'production', ...rest })).toThrow(/EXPO_PUBLIC_API_URL is not set/);
  });

  it('refuses a server secret in an EXPO_PUBLIC_ variable, even in development', () => {
    expect(() => evaluate({ EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'x' })).toThrow(/looks like a server secret/);
  });

  it('keeps camera, blocks permissions Lunti never uses, and configures notifications', () => {
    const config = evaluate({});
    const blocked = config.android?.blockedPermissions ?? [];
    expect(blocked).toEqual(
      expect.arrayContaining([
        'android.permission.RECORD_AUDIO',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.SYSTEM_ALERT_WINDOW',
      ]),
    );
    expect(blocked).not.toContain('android.permission.CAMERA');
    expect(blocked).not.toContain('android.permission.POST_NOTIFICATIONS');
    expect(blocked).not.toContain('android.permission.INTERNET');
    const notifications = config.plugins?.find((p) => Array.isArray(p) && p[0] === 'expo-notifications');
    // Must match the channel src/features/notifications/push.ts creates.
    expect(notifications).toEqual(['expo-notifications', expect.objectContaining({ defaultChannel: 'default' })]);
    // Camera plugin: no microphone for receipt photos.
    const camera = config.plugins?.find((p) => Array.isArray(p) && p[0] === 'expo-camera');
    expect(camera).toEqual(['expo-camera', expect.objectContaining({ recordAudioAndroid: false })]);
  });

  it('keeps Android predictive back off (custom Back handling in the scan flow)', () => {
    expect(evaluate({}).android?.predictiveBackGestureEnabled).toBe(false);
  });

  it('does not put a scheme in app.json (each variant sets its own)', () => {
    expect(appJson.expo.scheme).toBeUndefined();
  });
});

describe('eas.json', () => {
  it('has development, preview and production profiles, each pinned to its variant', () => {
    const { development, preview, production } = easJson.build;
    expect(development).toMatchObject({
      developmentClient: true,
      distribution: 'internal',
      environment: 'development',
      env: { APP_VARIANT: 'development' },
    });
    expect(preview).toMatchObject({
      distribution: 'internal',
      environment: 'preview',
      env: { APP_VARIANT: 'preview' },
      android: { buildType: 'apk' },
    });
    expect(production).toMatchObject({
      environment: 'production',
      env: { APP_VARIANT: 'production' },
      autoIncrement: true,
      android: { buildType: 'app-bundle' },
    });
  });

  it('versions builds remotely (no versionCode commits) and has no submit profile yet', () => {
    expect(easJson.cli.appVersionSource).toBe('remote');
    expect(easJson.submit).toBeUndefined();
  });

  it('commits no app config values in eas.json env other than the variant', () => {
    for (const profile of Object.values(easJson.build) as { env?: Record<string, string> }[]) {
      expect(Object.keys(profile.env ?? {})).toEqual(['APP_VARIANT']);
    }
  });
});

describe('committed env files', () => {
  it('.env.example lists only public EXPO_PUBLIC_ values', () => {
    const text = read('.env.example');
    const names = text
      .split('\n')
      .filter((line: string) => /^\s*[A-Z_]+=/.test(line))
      .map((line: string) => line.split('=')[0].trim());
    expect(names.sort()).toEqual(
      ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_URL'].sort(),
    );
  });

  it('git-ignores local env files, signing keys and EAS local credentials', () => {
    const ignore = read('.gitignore');
    for (const pattern of ['.env', '*.jks', '*.keystore', 'credentials.json', '/android']) {
      expect(ignore.split('\n')).toContain(pattern);
    }
  });
});
