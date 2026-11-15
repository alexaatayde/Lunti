/**
 * Fail-closed preflight for isolated emulator testing (see docs/android-build.md,
 * "Isolated emulator testing"). Run it AFTER starting the test Metro with the test
 * EXPO_PUBLIC_* overrides and BEFORE signing in or opening any financial screen:
 *
 *   npm run emulator:preflight -- --metro 8082 \
 *     --api http://127.0.0.1:8010/api/v1 --auth http://127.0.0.1:54321
 *
 * Options: --package (default ph.lunti.app.dev), --serial (adb device), --other-metro
 * (default 8081; the normal Metro must not own the app), --forbid-api-port (default 8000).
 *
 * It force-stops the app, leaves only the test ports in `adb reverse`, relaunches the dev
 * client on the test Metro, and then reads the RUNNING app's config over the debugger. Exit 0
 * only when every check passes; otherwise it lists the problems and exits 1. It prints no
 * keys or tokens. It never signs in and never calls the API or Supabase.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

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
} from './isolated-preflight/checks.ts';

const MOBILE_DIR = path.resolve(import.meta.dirname, '..');
const ENV_MODULE = 'src/lib/env.ts';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : fallback;
  if (value === undefined) fail([`Missing --${name}.`]);
  return value;
}

function fail(problems) {
  console.error('\nPREFLIGHT FAILED — do not sign in or test until this passes:');
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

function ok(message) {
  console.log(`  ✓ ${message}`);
}

const ADB =
  process.env.ADB ?? path.join(process.env.HOME ?? '', 'Library/Android/sdk/platform-tools/adb');
const serial = process.argv.includes('--serial') ? ['-s', arg('serial')] : [];

function adb(...args) {
  return execFileSync(ADB, [...serial, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function pidOf(pkg) {
  try {
    return adb('shell', 'pidof', pkg).trim() || null;
  } catch {
    return null; // pidof exits 1 when the app is not running
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Debugger targets on a Metro port, or null when nothing is listening. */
async function targets(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    return res.ok ? await res.json() : null;
  } catch {
    return null; // nothing listening
  }
}

/** One Runtime.evaluate over the Hermes inspector; returns the JSON value or null. */
async function evaluate(port, wsUrl, expression) {
  // `ws` ships with React Native's tooling; Metro's inspector proxy wants an Origin header.
  const WebSocket = createRequire(path.join(MOBILE_DIR, 'package.json'))('ws');
  return new Promise((resolve) => {
    const socket = new WebSocket(wsUrl, { headers: { Origin: `http://127.0.0.1:${port}` } });
    const timer = setTimeout(() => {
      socket.terminate();
      resolve(null);
    }, 10_000);
    socket.on('open', () =>
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true },
        }),
      ),
    );
    socket.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      resolve(msg.result?.result?.value ?? null);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function main() {
  const metro = Number(arg('metro'));
  const otherMetro = Number(arg('other-metro', '8081'));
  const pkg = arg('package', 'ph.lunti.app.dev');
  const dotenv = (() => {
    try {
      return readFileSync(path.join(MOBILE_DIR, '.env'), 'utf8');
    } catch {
      return '';
    }
  })();
  const envUrls = [...dotenv.matchAll(/^EXPO_PUBLIC_(?:SUPABASE|API)_URL=(.*)$/gm)].map((m) =>
    m[1].replace(/^["']|["']$/g, ''),
  );
  const t = {
    apiUrl: arg('api'),
    authUrl: arg('auth'),
    forbiddenApiPorts: [Number(arg('forbid-api-port', '8000'))],
    // The normal (real) Supabase project from .env must not be anywhere in the test bundle.
    forbiddenHosts: nonLoopbackHosts(envUrls).filter((h) => h !== '10.0.2.2'),
  };

  console.log('Isolated emulator preflight');
  const targetIssues = targetProblems(t);
  if (targetIssues.length) fail(targetIssues);
  ok('Test API and auth stub are loopback servers, not the live API port');

  // 1. The bundle the test Metro serves.
  let bundle = '';
  try {
    const manifest = await (
      await fetch(`http://127.0.0.1:${metro}/`, {
        headers: { 'expo-platform': 'android', accept: 'application/expo+json,application/json' },
      })
    ).json();
    bundle = await (await fetch(manifest.launchAsset.url)).text();
  } catch {
    fail([`Could not load the bundle from the test Metro on port ${metro}.`]);
  }
  const bundleIssues = bundleProblems(bundle, t);
  if (bundleIssues.length) fail(bundleIssues);
  ok(`Metro ${metro} bundle inlines only the test URLs`);
  const envModule = findModuleId(bundle, ENV_MODULE);
  if (envModule === null) fail([`Could not find ${ENV_MODULE} in the development bundle.`]);

  // 2. Fresh process, test ports only.
  const before = pidOf(pkg);
  adb('shell', 'am', 'force-stop', pkg);
  if (pidOf(pkg)) fail(['App is still running after force-stop.']);
  adb('reverse', '--remove-all');
  for (const p of expectedReversePorts(metro, t)) adb('reverse', `tcp:${p}`, `tcp:${p}`);
  const reverseIssues = reverseProblems(
    parseReverseList(adb('reverse', '--list')),
    expectedReversePorts(metro, t),
  );
  if (reverseIssues.length) fail(reverseIssues);
  ok(`App force-stopped; adb reverse = ${expectedReversePorts(metro, t).join(', ')} only`);

  const link = `exp+lunti://expo-development-client/?url=${encodeURIComponent(`http://127.0.0.1:${metro}`)}`;
  adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', link, pkg);
  let after = null;
  let target;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(2000);
    after = pidOf(pkg);
    target = (await targets(metro))?.find((x) =>
      `${x.title} ${x.description}`.includes(pkg),
    );
  }
  const relaunchIssues = relaunchProblems(before, after);
  if (relaunchIssues.length) fail(relaunchIssues);
  if (!target?.webSocketDebuggerUrl) fail([`App did not attach to the test Metro on ${metro}.`]);
  const elsewhere = (await targets(otherMetro))?.some((x) =>
    `${x.title} ${x.description}`.includes(pkg),
  );
  if (elsewhere) fail([`The app is also attached to Metro ${otherMetro} (old bundle).`]);
  ok(`New app process attached to Metro ${metro}`);

  // 3. What the running app actually uses (the final word).
  const runtime = await evaluate(
    metro,
    target.webSocketDebuggerUrl,
    `(function(){var e=__r(${envModule}).env;return {apiUrl:e.apiUrl,supabaseUrl:e.supabaseUrl}})()`,
  );
  const runtimeIssues = runtimeProblems(runtime, t);
  if (runtimeIssues.length) fail(runtimeIssues);
  ok('Running app uses the test API and the auth stub (live Supabase Auth unreachable)');

  console.log('\nPREFLIGHT PASSED — safe to sign in with a synthetic test account.');
}

main().catch(() => fail(['Unexpected error (check adb, Metro and the emulator).']));
