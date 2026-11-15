/**
 * Phase 8D.2: MainActivity must not be recreated by font, display-size, bold-text or language
 * changes (a recreated activity mounted a second React root and the next navigation crashed the
 * release build). See plugins/withActivityConfigChanges.ts.
 */
import {
  EXTRA_ACTIVITY_CONFIG_CHANGES,
  mergeConfigChanges,
  setActivityConfigChanges,
} from '../../plugins/withActivityConfigChanges';

/** The value Expo SDK 58's prebuild template writes for MainActivity. */
const TEMPLATE =
  'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize|assetsPaths';

/** Valid android:configChanges flag names (Android attr flags, compileSdk 37). */
const ANDROID_FLAGS = new Set([
  'mcc', 'mnc', 'locale', 'touchscreen', 'keyboard', 'keyboardHidden', 'navigation',
  'orientation', 'screenLayout', 'uiMode', 'screenSize', 'smallestScreenSize', 'density',
  'layoutDirection', 'colorMode', 'grammaticalGender', 'fontWeightAdjustment', 'fontScale',
  'resourcesUnused', 'assetsPaths',
]);

function manifestWith(configChanges: string | undefined) {
  const mainActivity = {
    $: { 'android:name': '.MainActivity', 'android:configChanges': configChanges },
    'intent-filter': [
      {
        action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
        category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
      },
    ],
  };
  const other = { $: { 'android:name': '.OtherActivity', 'android:configChanges': 'orientation' } };
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [{ $: { 'android:name': '.MainApplication' }, activity: [other, mainActivity] }],
    },
  } as never;
}

describe('mergeConfigChanges', () => {
  it('adds font, display-size, bold-text and language changes to the template value', () => {
    expect(mergeConfigChanges(TEMPLATE)).toBe(
      `${TEMPLATE}|fontScale|density|fontWeightAdjustment|locale|layoutDirection`,
    );
  });

  it('keeps existing flags and their order, and adds nothing twice', () => {
    expect(mergeConfigChanges('locale|orientation|fontScale')).toBe(
      'locale|orientation|fontScale|density|fontWeightAdjustment|layoutDirection',
    );
    const once = mergeConfigChanges(TEMPLATE);
    expect(mergeConfigChanges(once)).toBe(once);
  });

  it('handles a missing or messy value', () => {
    expect(mergeConfigChanges(undefined)).toBe(EXTRA_ACTIVITY_CONFIG_CHANGES.join('|'));
    expect(mergeConfigChanges(' orientation || uiMode ')).toBe(
      `orientation|uiMode|${EXTRA_ACTIVITY_CONFIG_CHANGES.join('|')}`,
    );
  });

  it('only uses flag names aapt accepts', () => {
    for (const flag of mergeConfigChanges(TEMPLATE).split('|')) {
      expect(ANDROID_FLAGS.has(flag)).toBe(true);
    }
  });
});

describe('setActivityConfigChanges', () => {
  it('updates the launcher activity only', () => {
    const result = setActivityConfigChanges(manifestWith(TEMPLATE)) as unknown as {
      manifest: { application: { activity: { $: Record<string, string> }[] }[] };
    };
    const [other, main] = result.manifest.application[0].activity;
    expect(main.$['android:configChanges'].split('|')).toEqual(
      expect.arrayContaining(['fontScale', 'density', 'fontWeightAdjustment', 'locale']),
    );
    expect(other.$['android:configChanges']).toBe('orientation');
  });
});
