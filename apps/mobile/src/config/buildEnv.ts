/**
 * Build variants and the rules for the public values bundled into the app.
 *
 * Pure TypeScript with no React Native imports: `app.config.ts` runs it in Node when a build
 * is configured (and fails the build on an error), and the app runs it again at startup
 * (src/lib/env.ts) so a misconfigured build shows a setup screen instead of talking to the
 * wrong server.
 *
 * Everything named EXPO_PUBLIC_* is inlined into the JavaScript bundle and can be read by
 * anyone who has the APK. Only the API address and Supabase's public (anon/publishable) key
 * belong there — never service-role, Vision, OpenAI or Firebase server keys (AGENTS.md §4.7).
 */

export const APP_VARIANTS = ['development', 'preview', 'production'] as const;
export type AppVariant = (typeof APP_VARIANTS)[number];

/** `APP_VARIANT` unset means a local developer run (Expo Go, `expo run:android`). */
export const DEFAULT_VARIANT: AppVariant = 'development';

/**
 * Per-variant identity, so development, preview and production can be installed side by side
 * and a password-reset link opens the app that asked for it (the PKCE secret lives there).
 *
 * PROVISIONAL: `ph.lunti.app` is not final (AGENTS.md §13). The package name can't change
 * after the first Play Store upload, so it must be approved before any production build.
 */
export const VARIANT_IDENTITY: Record<
  AppVariant,
  { name: string; androidPackage: string; scheme: string; label: string | null }
> = {
  development: {
    name: 'Lunti Dev',
    androidPackage: 'ph.lunti.app.dev',
    scheme: 'lunti-dev',
    label: 'Development',
  },
  preview: {
    name: 'Lunti Preview',
    androidPackage: 'ph.lunti.app.preview',
    scheme: 'lunti-preview',
    label: 'Preview',
  },
  production: {
    name: 'Lunti',
    androidPackage: 'ph.lunti.app',
    scheme: 'lunti',
    label: null,
  },
};

export function parseVariant(raw: string | undefined): AppVariant {
  const value = (raw ?? '').trim();
  if (!value) return DEFAULT_VARIANT;
  if ((APP_VARIANTS as readonly string[]).includes(value)) return value as AppVariant;
  throw new Error(
    `APP_VARIANT must be one of ${APP_VARIANTS.join(', ')} (got "${value}").`,
  );
}

/** Development builds may talk to a laptop or emulator; release builds never may. */
export function isReleaseVariant(variant: AppVariant): boolean {
  return variant !== 'development';
}

type Env = Record<string, string | undefined>;

/** EXPO_PUBLIC_* names that look like they carry a server-side secret. */
const SECRET_NAME = /SERVICE[_-]?ROLE|SECRET|PRIVATE|PASSWORD|OPENAI|VISION|GOOGLE_APPLICATION|CREDENTIAL|FCM|FIREBASE_ADMIN|DATABASE|JWT/i;

/** Values that are server-side secrets whatever they are named. */
function secretValueKind(value: string): string | null {
  const v = value.trim();
  if (v.startsWith('sb_secret_')) return 'a Supabase secret key';
  if (/^sk-[A-Za-z0-9_-]{10,}/.test(v)) return 'an OpenAI API key';
  if (v.includes('-----BEGIN')) return 'a private key';
  if (/"type"\s*:\s*"service_account"/.test(v)) return 'a Google service-account credential';
  if (/^postgres(ql)?:\/\//i.test(v)) return 'a database connection string';
  if (jwtRole(v) === 'service_role') return 'the Supabase service-role key';
  return null;
}

/** The `role` claim of a Supabase legacy JWT key, or null if `value` isn't a JWT. */
export function jwtRole(value: string): string | null {
  const parts = value.trim().split('.');
  if (parts.length !== 3) return null;
  try {
    const json = decodeBase64Url(parts[1]);
    const payload = JSON.parse(json) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Small base64url decoder: works the same in Node (build) and Hermes (app), no Buffer/atob. */
function decodeBase64Url(input: string): string {
  const clean = input.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const ch of clean) {
    const index = B64.indexOf(ch);
    if (index < 0) throw new Error('not base64');
    acc = (acc << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >> bits) & 0xff);
    }
  }
  return out;
}

/** Hosts that only exist on a developer's machine or local network. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '0.0.0.0') return true;
  // IPv6 loopback, link-local (fe80::/10) and unique-local (fc00::/7) addresses.
  if (host.includes(':')) return host === '::1' || /^fe[89ab]/.test(host) || /^f[cd]/.test(host);
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return (
    a === 127 ||
    a === 10 || // includes the Android emulator's 10.0.2.2
    a === 0 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT / Tailscale
  );
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

export type PublicConfig = {
  apiUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
};

/**
 * Problems with the public config for `variant`. Empty means the build may proceed.
 * Release variants (preview, production) need explicit HTTPS addresses that aren't local.
 */
export function publicConfigProblems(variant: AppVariant, config: PublicConfig): string[] {
  const problems: string[] = [];
  const release = isReleaseVariant(variant);

  const checkUrl = (name: string, value: string) => {
    if (!value.trim()) {
      if (release) problems.push(`${name} is not set. Release builds need an explicit address.`);
      return;
    }
    const url = parseUrl(value);
    if (!url || !/^https?:$/.test(url.protocol)) {
      problems.push(`${name} is not a valid http(s) URL.`);
      return;
    }
    if (!release) return;
    if (url.protocol !== 'https:') problems.push(`${name} must use https in a ${variant} build.`);
    if (isLocalHost(url.hostname)) {
      problems.push(`${name} points at a local address (${url.hostname}) in a ${variant} build.`);
    }
  };

  checkUrl('EXPO_PUBLIC_API_URL', config.apiUrl);
  checkUrl('EXPO_PUBLIC_SUPABASE_URL', config.supabaseUrl);

  if (!config.supabaseAnonKey.trim()) {
    if (release) problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is not set.');
  } else {
    const role = jwtRole(config.supabaseAnonKey);
    if (role && role !== 'anon') {
      problems.push(
        `EXPO_PUBLIC_SUPABASE_ANON_KEY is a "${role}" key. Only the public anon/publishable key may ship in the app.`,
      );
    }
  }
  return problems;
}

/**
 * Every EXPO_PUBLIC_* variable in `env` that is, or is named like, a server secret.
 * Checked for all variants: a secret in a development bundle is still a leaked secret.
 */
export function leakedSecretProblems(env: Env): string[] {
  const problems: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('EXPO_PUBLIC_')) continue;
    if (SECRET_NAME.test(name)) {
      problems.push(`${name} looks like a server secret and must not be an EXPO_PUBLIC_ variable.`);
      continue;
    }
    const kind = value ? secretValueKind(value) : null;
    if (kind) problems.push(`${name} contains ${kind}; it would be readable by anyone with the app.`);
  }
  return problems;
}

/** All build-time problems for `variant`. `app.config.ts` refuses to configure a build with any. */
export function buildEnvProblems(variant: AppVariant, env: Env): string[] {
  return [
    ...leakedSecretProblems(env),
    ...publicConfigProblems(variant, {
      apiUrl: env.EXPO_PUBLIC_API_URL ?? '',
      supabaseUrl: env.EXPO_PUBLIC_SUPABASE_URL ?? '',
      supabaseAnonKey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    }),
  ];
}
