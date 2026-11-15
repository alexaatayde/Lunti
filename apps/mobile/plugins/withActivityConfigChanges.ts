/**
 * Config plugin: MainActivity handles font, display-size, bold-text and language changes itself
 * instead of being destroyed and recreated by Android.
 *
 * Why (Phase 8D.2): a recreated activity runs the React root again in the same JS runtime while
 * the old one is still registered. expo-router then has two navigation containers on its shared
 * imperative router, and the next router.push() throws "The imperative router is unavailable
 * before the first render has finished" — fatal in a release build. Reproduced on the R8 release
 * APK by changing Settings → Display → Font size and then tapping any navigation button.
 *
 * With these flags React Native receives onConfigurationChanged instead. On its own that left a
 * font-size change made while the app stays on screen invisible to JS until the next resume;
 * withFontScaleRefresh.ts forwards it.
 * Expo's template already lists orientation, screen size and uiMode (dark mode) for the same reason.
 */
import { AndroidConfig, withAndroidManifest, type ConfigPlugin } from 'expo/config-plugins';

/** Added to the template's configChanges. All are valid with compileSdk 37 (fontWeightAdjustment: API 31+). */
export const EXTRA_ACTIVITY_CONFIG_CHANGES = [
  'fontScale',
  'density',
  'fontWeightAdjustment',
  'locale',
  'layoutDirection',
] as const;

/** Adds the extra flags to an android:configChanges value, keeping existing ones and their order. */
export function mergeConfigChanges(
  current: string | undefined,
  extra: readonly string[] = EXTRA_ACTIVITY_CONFIG_CHANGES,
): string {
  const values = (current ?? '')
    .split('|')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const value of extra) {
    if (!values.includes(value)) values.push(value);
  }
  return values.join('|');
}

/** Applies mergeConfigChanges to the main (launcher) activity of a parsed AndroidManifest. */
export function setActivityConfigChanges(
  manifest: AndroidConfig.Manifest.AndroidManifest,
): AndroidConfig.Manifest.AndroidManifest {
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
  activity.$['android:configChanges'] = mergeConfigChanges(activity.$['android:configChanges']);
  return manifest;
}

export const withActivityConfigChanges: ConfigPlugin = (config) =>
  withAndroidManifest(config, (mod) => {
    mod.modResults = setActivityConfigChanges(mod.modResults);
    return mod;
  });
