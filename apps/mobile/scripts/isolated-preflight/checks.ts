/**
 * Pure checks for the isolated emulator preflight (scripts/isolated-emulator-preflight.ts).
 *
 * Why: in Phase 8D.3 an emulator quickboot snapshot restored Lunti Dev already running an OLD
 * bundle (real Supabase config). Relaunching only brought it to the front, so a test sign-in
 * reached live Supabase Auth. The preflight now proves, before anyone signs in, that the
 * running app is a fresh process using the isolated test API and auth stub. Every check
 * fails closed: anything unexpected or unverifiable is a problem.
 *
 * No I/O here (unit-tested in __tests__/config/isolatedPreflight.test.ts).
 */

export type PreflightTargets = {
  /** e.g. http://127.0.0.1:8010/api/v1 — the isolated test API. */
  apiUrl: string;
  /** e.g. http://127.0.0.1:54321 — the local auth stub. */
  authUrl: string;
  /** Ports that must never be the test API (the developer API on live data). */
  forbiddenApiPorts: number[];
  /** Hosts that must not appear in the test bundle (the real Supabase project). */
  forbiddenHosts: string[];
};

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function port(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

/** The targets themselves: loopback only (reached through `adb reverse`), never the live API port. */
export function targetProblems(t: PreflightTargets): string[] {
  const problems: string[] = [];
  for (const [name, raw] of [
    ['API URL', t.apiUrl],
    ['Auth URL', t.authUrl],
  ] as const) {
    const url = parse(raw);
    if (!url || !/^https?:$/.test(url.protocol)) {
      problems.push(`${name} is not an http(s) URL.`);
      continue;
    }
    if (!LOOPBACK.has(url.hostname)) {
      problems.push(`${name} must be a loopback address (got ${url.hostname}).`);
    }
  }
  const api = parse(t.apiUrl);
  if (api && t.forbiddenApiPorts.includes(port(api))) {
    problems.push(`API URL uses port ${port(api)}, the developer API on live data.`);
  }
  const auth = parse(t.authUrl);
  if (api && auth && api.host === auth.host) {
    problems.push('API URL and Auth URL must be different servers.');
  }
  return problems;
}

/** Forward-only ports needed by the test: Metro, test API, auth stub. */
export function expectedReversePorts(metroPort: number, t: PreflightTargets): number[] {
  const ports = [metroPort];
  for (const raw of [t.apiUrl, t.authUrl]) {
    const url = parse(raw);
    if (url) ports.push(port(url));
  }
  return [...new Set(ports)].sort((a, b) => a - b);
}

/** Parses `adb reverse --list` ("host-7 tcp:8082 tcp:8082" per line) into device ports. */
export function parseReverseList(output: string): number[] {
  const ports: number[] = [];
  for (const line of output.split('\n')) {
    const m = /\btcp:(\d+)\s+tcp:\d+/.exec(line);
    if (m) ports.push(Number(m[1]));
  }
  return ports.sort((a, b) => a - b);
}

export function reverseProblems(actual: number[], expected: number[]): string[] {
  const extra = actual.filter((p) => !expected.includes(p));
  const missing = expected.filter((p) => !actual.includes(p));
  const problems: string[] = [];
  if (extra.length) problems.push(`Unexpected adb reverse ports: ${extra.join(', ')}.`);
  if (missing.length) problems.push(`Missing adb reverse ports: ${missing.join(', ')}.`);
  return problems;
}

/**
 * The bundle Metro serves: both target URLs are inlined, and nothing points at the real
 * project or the live API port. (The runtime check below is the final word.)
 */
export function bundleProblems(bundle: string, t: PreflightTargets): string[] {
  const problems: string[] = [];
  if (!bundle.includes(`"${t.apiUrl}"`)) problems.push('Bundle does not contain the test API URL.');
  if (!bundle.includes(`"${t.authUrl}"`)) {
    problems.push('Bundle does not contain the auth stub URL.');
  }
  for (const host of t.forbiddenHosts) {
    if (host && bundle.includes(host)) problems.push(`Bundle references a forbidden host (${host}).`);
  }
  for (const p of t.forbiddenApiPorts) {
    if (new RegExp(`:${p}/api\\b`).test(bundle)) {
      problems.push(`Bundle references an API on forbidden port ${p}.`);
    }
  }
  return problems;
}

/** Module id Metro assigned to a source file in a development bundle (`__d(f, id, deps, "path")`). */
export function findModuleId(bundle: string, sourcePath: string): number | null {
  const escaped = sourcePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`\\},(\\d+),\\[[\\d,]*\\],"${escaped}"`).exec(bundle);
  return m ? Number(m[1]) : null;
}

/** What the RUNNING app resolved (src/lib/env.ts `env`, read over the debugger). */
export function runtimeProblems(
  runtime: { apiUrl?: unknown; supabaseUrl?: unknown } | null,
  t: PreflightTargets,
): string[] {
  if (!runtime) return ['Could not read the running app configuration.'];
  const problems: string[] = [];
  if (runtime.apiUrl !== t.apiUrl) problems.push('Running app is not using the test API URL.');
  if (runtime.supabaseUrl !== t.authUrl) {
    problems.push('Running app is not using the auth stub (it could reach live Supabase Auth).');
  }
  return problems;
}

/** The app must be a NEW process started after the force-stop (not a snapshot leftover). */
export function relaunchProblems(before: string | null, after: string | null): string[] {
  if (!after) return ['App process did not start after relaunch.'];
  if (before && before === after) return ['App process was not restarted (same pid as before).'];
  return [];
}

/** Hosts from a URL list that are not loopback (e.g. the real Supabase URL in .env). */
export function nonLoopbackHosts(urls: string[]): string[] {
  const hosts: string[] = [];
  for (const raw of urls) {
    const url = parse(raw.trim());
    if (url && !LOOPBACK.has(url.hostname)) hosts.push(url.hostname);
  }
  return hosts;
}
