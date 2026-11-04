/**
 * Public app config from apps/mobile/.env (see .env.example).
 * Expo inlines EXPO_PUBLIC_* at build time, so each variable must be read by its full name.
 * Only public values belong here — never service-role, Vision or OpenAI keys (AGENTS.md §4.7).
 */
export const env = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
};

/** Names of the Supabase variables that are still empty. */
export const missingSupabaseEnv = [
  ['EXPO_PUBLIC_SUPABASE_URL', env.supabaseUrl],
  ['EXPO_PUBLIC_SUPABASE_ANON_KEY', env.supabaseAnonKey],
]
  .filter(([, value]) => !value.trim())
  .map(([name]) => name);
