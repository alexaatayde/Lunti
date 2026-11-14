/**
 * Supabase client. The app uses Supabase directly for auth only (AGENTS.md §3);
 * all data goes through the FastAPI backend.
 */
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

import { createAuthStorage, type KeyValueStore } from './authStorage';
import { configProblems, env, missingSupabaseEnv } from './env';
import { installWebCrypto } from './webCrypto';

// PKCE needs Web Crypto, which Hermes lacks (see webCrypto.ts). Installed before the client.
installWebCrypto();

// expo-secure-store has no web implementation; the web build (dev only) falls back to AsyncStorage.
const webStore: KeyValueStore = {
  getItemAsync: (key) => AsyncStorage.getItem(key),
  setItemAsync: (key, value) => AsyncStorage.setItem(key, value),
  deleteItemAsync: (key) => AsyncStorage.removeItem(key),
};

export const authStorage = createAuthStorage(Platform.OS === 'web' ? webStore : SecureStore);

/** False when values are missing or unsafe (see env.ts); the root layout then shows SetupRequired. */
export const isSupabaseConfigured = missingSupabaseEnv.length === 0 && configProblems.length === 0;
export { configProblems, missingSupabaseEnv };

/** Where supabase-js keeps the session in `authStorage`. */
export const AUTH_STORAGE_KEY = 'lunti.auth';

/** null when .env is missing the Supabase values; the root layout then shows a setup message. */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        storage: authStorage,
        storageKey: AUTH_STORAGE_KEY,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        // PKCE: a password-reset link carries a one-time code, not tokens, and the code only
        // works together with a secret kept on the phone that asked for the reset.
        flowType: 'pkce',
      },
    })
  : null;

// Refresh tokens only while the app is in the foreground (Supabase React Native guidance).
if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
