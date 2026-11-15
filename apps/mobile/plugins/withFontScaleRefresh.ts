/**
 * Config plugin: tell JavaScript about a system font-size change while Lunti stays on screen.
 *
 * Why: withActivityConfigChanges (d147a99) makes MainActivity handle `fontScale` itself, so
 * Android calls onConfigurationChanged instead of recreating the activity (recreation mounted a
 * second React root and crashed the release build). React Native then updates its native display
 * metrics and relayouts, but its DeviceInfo module (the source of `Dimensions` /
 * `useWindowDimensions().fontScale` in JS) re-reads the font scale only in onHostResume(). A change
 * made while the app stays resumed (quick-settings tile, accessibility shortcut) never reached JS
 * until the next background → foreground.
 *
 * Fix: after React Native's own handling, MainActivity calls DeviceInfo's existing
 * onHostResume() once more. It re-reads `configuration.fontScale` and emits `didUpdateDimensions`
 * only when the value changed; otherwise it does nothing. The activity is never recreated and the
 * configChanges flags are untouched.
 *
 * Checked against React Native 0.88.1 / Expo SDK 58 (node_modules sources):
 * - DeviceInfoModule is Kotlin `internal`, so it is looked up by its registered name ("DeviceInfo",
 *   a string constant R8 does not rename) and used through the public LifecycleEventListener
 *   interface. If a future version renames it or drops the interface, the call is a no-op.
 * - Runs on the main thread (posted to the main looper), where React Native normally calls
 *   onHostResume. Posting also lets Expo's ReactActivityDelegateWrapper, which forwards
 *   onConfigurationChanged through a coroutine, finish first.
 * - `reactHost` is ReactActivity.getReactHost(), which Expo's wrapper overrides.
 */
import { withMainActivity, type ConfigPlugin } from 'expo/config-plugins';

/** Marker line that makes the change idempotent (prebuild may run on an existing android/). */
export const FONT_SCALE_REFRESH_MARKER = '// @lunti/font-scale-refresh';

export const FONT_SCALE_REFRESH_IMPORTS = [
  'android.content.res.Configuration',
  'android.os.Handler',
  'android.os.Looper',
  'com.facebook.react.bridge.LifecycleEventListener',
] as const;

const CLASS_ANCHOR = /^class MainActivity\s*:\s*ReactActivity\(\)\s*\{[^\S\n]*$/m;

export const FONT_SCALE_REFRESH_METHOD = `  ${FONT_SCALE_REFRESH_MARKER}
  // Font size changed while Lunti is on screen (the activity is not recreated: configChanges).
  // React Native updates native metrics in super; DeviceInfo re-reads fontScale only on resume,
  // so ask it once more. It emits didUpdateDimensions to JS only if the scale really changed.
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    Handler(Looper.getMainLooper()).post {
      (reactHost?.currentReactContext?.getNativeModule("DeviceInfo") as? LifecycleEventListener)
        ?.onHostResume()
    }
  }
`;

export class FontScaleRefreshError extends Error {
  constructor(message: string) {
    super(
      `withFontScaleRefresh: ${message} The generated MainActivity no longer matches what this ` +
        'plugin was written for (Expo SDK 58 / React Native 0.88). Check the template and update ' +
        'apps/mobile/plugins/withFontScaleRefresh.ts.',
    );
    this.name = 'FontScaleRefreshError';
  }
}

/** Adds the imports that are missing, after the last existing import (or the package line). */
function addImports(source: string): string {
  const missing = FONT_SCALE_REFRESH_IMPORTS.filter(
    (name) => !new RegExp(`^import ${name.replace(/\./g, '\\.')}\\s*$`, 'm').test(source),
  );
  if (missing.length === 0) return source;
  const lines = source.split('\n');
  let at = -1;
  lines.forEach((line, i) => {
    if (/^import\s/.test(line)) at = i;
  });
  if (at === -1) at = lines.findIndex((line) => /^package\s/.test(line));
  if (at === -1) throw new FontScaleRefreshError('No package or import line was found.');
  lines.splice(at + 1, 0, ...missing.map((name) => `import ${name}`));
  return lines.join('\n');
}

/**
 * Returns MainActivity.kt with the onConfigurationChanged override. Applying it twice gives the
 * same file. Throws FontScaleRefreshError when the file is not the expected Kotlin template, or
 * when it already overrides onConfigurationChanged (merging two overrides automatically is unsafe).
 */
export function addFontScaleRefresh(source: string, language: string = 'kt'): string {
  if (language !== 'kt') {
    throw new FontScaleRefreshError(`MainActivity is "${language}", expected Kotlin ("kt").`);
  }
  if (source.includes(FONT_SCALE_REFRESH_MARKER)) return source;
  if (/\bfun\s+onConfigurationChanged\s*\(/.test(source)) {
    throw new FontScaleRefreshError(
      'MainActivity already overrides onConfigurationChanged (from another plugin or a manual edit).',
    );
  }
  const anchor = CLASS_ANCHOR.exec(source);
  if (!anchor) {
    throw new FontScaleRefreshError('"class MainActivity : ReactActivity() {" was not found.');
  }
  const insertAt = anchor.index + anchor[0].length;
  const withMethod = `${source.slice(0, insertAt)}\n${FONT_SCALE_REFRESH_METHOD}${source.slice(insertAt)}`;
  return addImports(withMethod);
}

export const withFontScaleRefresh: ConfigPlugin = (config) =>
  withMainActivity(config, (mod) => {
    mod.modResults.contents = addFontScaleRefresh(
      mod.modResults.contents,
      mod.modResults.language,
    );
    return mod;
  });
