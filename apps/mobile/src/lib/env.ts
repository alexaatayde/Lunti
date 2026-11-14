/**
 * Public app config from apps/mobile/.env (see .env.example) or, for EAS builds, the EAS
 * environment of the build profile. Expo inlines EXPO_PUBLIC_* at build time, so each variable
 * must be read by its full name.
 * Only public values belong here — never service-role, Vision or OpenAI keys (AGENTS.md §4.7).
 */
import Constants from 'expo-constants';

import {
  APP_VARIANTS,
  VARIANT_IDENTITY,
  publicConfigProblems,
  type AppVariant,
} from '../config/buildEnv';

export const env = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
};

/**
 * The build variant app.config.ts stamped into `extra.appVariant`. If it's missing, an
 * optimized (non-__DEV__) bundle is treated as production so the release checks still apply.
 */
export function resolveVariant(raw: unknown, isDev: boolean): AppVariant {
  if (typeof raw === 'string' && (APP_VARIANTS as readonly string[]).includes(raw)) {
    return raw as AppVariant;
  }
  return isDev ? 'development' : 'production';
}

export const appVariant: AppVariant = resolveVariant(
  (Constants.expoConfig?.extra as { appVariant?: unknown } | undefined)?.appVariant,
  __DEV__,
);

/** "Development" / "Preview" for non-production builds (shown on Profile), else null. */
export const environmentLabel: string | null = VARIANT_IDENTITY[appVariant].label;

/** Names of the Supabase variables that are still empty. */
export const missingSupabaseEnv = [
  ['EXPO_PUBLIC_SUPABASE_URL', env.supabaseUrl],
  ['EXPO_PUBLIC_SUPABASE_ANON_KEY', env.supabaseAnonKey],
]
  .filter(([, value]) => !value.trim())
  .map(([name]) => name);

/**
 * Unsafe or missing values for this variant: in preview/production an http, local or missing
 * API/Supabase address; in any build a non-anon Supabase key. The app refuses to start with any
 * (SetupRequired) rather than quietly talking to a laptop or leaking a privileged key.
 * The build itself already fails on these in app.config.ts; this catches a bundle built some
 * other way.
 */
export const configProblems: string[] = publicConfigProblems(appVariant, env).filter(
  // Missing Supabase values are listed by name above.
  (problem) => !missingSupabaseEnv.some((name) => problem.startsWith(`${name} is not set`)),
);

/** Store-facing version from app.json (`expo.version`). */
export const appVersion: string = Constants.expoConfig?.version ?? '';

/** "1.0.0 · Development build" for non-production builds, "1.0.0" for production. */
export function versionText(version: string = appVersion, label: string | null = environmentLabel) {
  const base = version || 'Unknown version';
  return label ? `${base} · ${label} build` : base;
}
