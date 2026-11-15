import {
  bundleProblems,
  expectedReversePorts,
  findModuleId,
  nonLoopbackHosts,
  parseReverseList,
  relaunchProblems,
  reverseProblems,
  runtimeProblems,
  targetProblems,
  type PreflightTargets,
} from '../../scripts/isolated-preflight/checks';

const T: PreflightTargets = {
  apiUrl: 'http://127.0.0.1:8010/api/v1',
  authUrl: 'http://127.0.0.1:54321',
  forbiddenApiPorts: [8000],
  forbiddenHosts: ['abcdefghijklmnop.supabase.co'],
};

const inlined = (api: string, auth: string) =>
  `var env={"EXPO_PUBLIC_API_URL": { value: "${api}" },"EXPO_PUBLIC_SUPABASE_URL": { value: "${auth}" }};`;

describe('isolated emulator preflight checks', () => {
  it('accepts loopback test servers', () => {
    expect(targetProblems(T)).toEqual([]);
  });

  it('refuses a real host, the live API port, or one server for both', () => {
    expect(targetProblems({ ...T, authUrl: 'https://abcdefghijklmnop.supabase.co' })).toEqual([
      'Auth URL must be a loopback address (got abcdefghijklmnop.supabase.co).',
    ]);
    expect(targetProblems({ ...T, apiUrl: 'http://127.0.0.1:8000/api/v1' })).toEqual([
      'API URL uses port 8000, the developer API on live data.',
    ]);
    expect(targetProblems({ ...T, apiUrl: 'http://10.0.2.2:8010/api/v1' })[0]).toMatch(/loopback/);
    expect(targetProblems({ ...T, authUrl: 'http://127.0.0.1:8010' })).toContain(
      'API URL and Auth URL must be different servers.',
    );
    expect(targetProblems({ ...T, apiUrl: 'not a url' })).toContain('API URL is not an http(s) URL.');
  });

  it('accepts only a bundle that inlines both test URLs and nothing live', () => {
    expect(bundleProblems(inlined(T.apiUrl, T.authUrl), T)).toEqual([]);
    // The stale normal bundle: real project + developer API.
    expect(
      bundleProblems(
        inlined('http://10.0.2.2:8000/api/v1', 'https://abcdefghijklmnop.supabase.co'),
        T,
      ),
    ).toEqual([
      'Bundle does not contain the test API URL.',
      'Bundle does not contain the auth stub URL.',
      'Bundle references a forbidden host (abcdefghijklmnop.supabase.co).',
      'Bundle references an API on forbidden port 8000.',
    ]);
    expect(bundleProblems(inlined(T.apiUrl, T.authUrl) + ' abcdefghijklmnop.supabase.co', T)).toEqual(
      ['Bundle references a forbidden host (abcdefghijklmnop.supabase.co).'],
    );
  });

  it('requires exactly the Metro, API and stub ports in adb reverse', () => {
    const expected = expectedReversePorts(8082, T);
    expect(expected).toEqual([8010, 8082, 54321]);
    const listed = parseReverseList(
      'host-7 tcp:8082 tcp:8082\nhost-7 tcp:8010 tcp:8010\nhost-7 tcp:54321 tcp:54321\n',
    );
    expect(reverseProblems(listed, expected)).toEqual([]);
    expect(reverseProblems([...listed, 8081].sort(), expected)).toEqual([
      'Unexpected adb reverse ports: 8081.',
    ]);
    expect(reverseProblems([8082], expected)).toEqual(['Missing adb reverse ports: 8010, 54321.']);
  });

  it('finds the env module id in a development bundle', () => {
    const bundle = '__d(function(){},1473,[1,2],"src/lib/other.ts");__d(function(){},1474,[3],"src/lib/env.ts");';
    expect(findModuleId(bundle, 'src/lib/env.ts')).toBe(1474);
    expect(findModuleId(bundle, 'src/lib/missing.ts')).toBeNull();
  });

  it('trusts only the running app configuration', () => {
    expect(runtimeProblems({ apiUrl: T.apiUrl, supabaseUrl: T.authUrl }, T)).toEqual([]);
    expect(runtimeProblems(null, T)).toEqual(['Could not read the running app configuration.']);
    expect(
      runtimeProblems({ apiUrl: T.apiUrl, supabaseUrl: 'https://abcdefghijklmnop.supabase.co' }, T),
    ).toEqual(['Running app is not using the auth stub (it could reach live Supabase Auth).']);
  });

  it('requires a new app process after the force-stop', () => {
    expect(relaunchProblems('28170', '28864')).toEqual([]);
    expect(relaunchProblems(null, '28864')).toEqual([]);
    expect(relaunchProblems('28170', '28170')).toEqual([
      'App process was not restarted (same pid as before).',
    ]);
    expect(relaunchProblems('28170', null)).toEqual(['App process did not start after relaunch.']);
  });

  it('collects non-loopback hosts from the normal .env', () => {
    expect(
      nonLoopbackHosts(['https://abcdefghijklmnop.supabase.co', 'http://127.0.0.1:54321', 'nope']),
    ).toEqual(['abcdefghijklmnop.supabase.co']);
  });
});
