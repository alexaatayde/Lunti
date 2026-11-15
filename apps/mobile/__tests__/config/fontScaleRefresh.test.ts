/**
 * A font-size change made while Lunti stays on screen must reach JS without recreating
 * MainActivity. See plugins/withFontScaleRefresh.ts (and withActivityConfigChanges.ts for why the
 * activity must not be recreated).
 */
import {
  FONT_SCALE_REFRESH_IMPORTS,
  FONT_SCALE_REFRESH_MARKER,
  FontScaleRefreshError,
  addFontScaleRefresh,
} from '../../plugins/withFontScaleRefresh';
import {
  EXTRA_ACTIVITY_CONFIG_CHANGES,
  setActivityConfigChanges,
} from '../../plugins/withActivityConfigChanges';

const fs = jest.requireActual<{ readFileSync(file: string, encoding: 'utf8'): string }>('fs');
const ROOT = (expect.getState().testPath ?? '').replace(/[\\/]__tests__[\\/].*$/, '');

/** Expo SDK 58's MainActivity.kt template (node_modules/expo/template.tgz), package renamed. */
const TEMPLATE = fs.readFileSync(`${ROOT}/__tests__/config/fixtures/MainActivity.sdk58.kt.txt`, 'utf8');

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('addFontScaleRefresh', () => {
  const output = addFontScaleRefresh(TEMPLATE);

  it('adds one onConfigurationChanged override inside MainActivity that calls super first', () => {
    expect(count(output, 'override fun onConfigurationChanged(newConfig: Configuration)')).toBe(1);
    expect(count(output, FONT_SCALE_REFRESH_MARKER)).toBe(1);
    const method = output.slice(output.indexOf('override fun onConfigurationChanged'));
    expect(method.indexOf('super.onConfigurationChanged(newConfig)')).toBeLessThan(
      method.indexOf('onHostResume()'),
    );
    // Inside the class body, before the template's own members.
    expect(output.indexOf('class MainActivity : ReactActivity() {')).toBeLessThan(
      output.indexOf(FONT_SCALE_REFRESH_MARKER),
    );
    expect(output.indexOf(FONT_SCALE_REFRESH_MARKER)).toBeLessThan(
      output.indexOf('override fun onCreate'),
    );
  });

  it('reaches DeviceInfo by its registered name through the public listener interface', () => {
    // DeviceInfoModule is Kotlin `internal`: referencing the class would not compile.
    expect(output).not.toContain('DeviceInfoModule');
    expect(output).toContain('getNativeModule("DeviceInfo") as? LifecycleEventListener');
    expect(output).toContain('reactHost?.currentReactContext');
    expect(output).toContain('Handler(Looper.getMainLooper()).post');
  });

  it('never recreates the activity or reloads React', () => {
    for (const forbidden of ['recreate()', 'finish()', 'reload', 'startActivity', 'setContentView']) {
      expect(output).not.toContain(forbidden);
    }
  });

  it('adds each import once, after the existing imports', () => {
    for (const name of FONT_SCALE_REFRESH_IMPORTS) {
      expect(count(output, `import ${name}\n`)).toBe(1);
    }
    const lastImport = output.lastIndexOf('\nimport ');
    expect(lastImport).toBeLessThan(output.indexOf('class MainActivity'));
    expect(output.startsWith('package ph.lunti.app.dev\n')).toBe(true);
  });

  it('keeps the rest of the template unchanged', () => {
    const removedAdditions = output
      .split('\n')
      .filter((line) => !FONT_SCALE_REFRESH_IMPORTS.some((name) => line === `import ${name}`))
      .join('\n')
      .replace(/\n {2}\/\/ @lunti\/font-scale-refresh[\s\S]*?\n {2}\}\n/, '');
    expect(removedAdditions).toBe(TEMPLATE);
  });

  it('is idempotent', () => {
    expect(addFontScaleRefresh(output)).toBe(output);
    expect(addFontScaleRefresh(addFontScaleRefresh(output))).toBe(output);
  });

  it('does not duplicate an import the activity already has', () => {
    const withImport = TEMPLATE.replace(
      'import android.os.Build\n',
      'import android.os.Build\nimport android.os.Handler\n',
    );
    expect(count(addFontScaleRefresh(withImport), 'import android.os.Handler\n')).toBe(1);
  });

  it('fails clearly when the class declaration is not the expected template', () => {
    const changed = TEMPLATE.replace(
      'class MainActivity : ReactActivity() {',
      'class MainActivity : SomeOtherActivity() {',
    );
    expect(() => addFontScaleRefresh(changed)).toThrow(FontScaleRefreshError);
    expect(() => addFontScaleRefresh(changed)).toThrow(/class MainActivity : ReactActivity\(\)/);
  });

  it('refuses to add a second onConfigurationChanged override', () => {
    const existing = TEMPLATE.replace(
      'class MainActivity : ReactActivity() {',
      'class MainActivity : ReactActivity() {\n  override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {\n    super.onConfigurationChanged(newConfig)\n  }',
    );
    expect(() => addFontScaleRefresh(existing)).toThrow(/already overrides onConfigurationChanged/);
  });

  it('refuses a Java MainActivity', () => {
    expect(() => addFontScaleRefresh('public class MainActivity {}', 'java')).toThrow(
      /expected Kotlin/,
    );
  });

  it('fails clearly on a file with no package line', () => {
    expect(() => addFontScaleRefresh('class MainActivity : ReactActivity() {\n}\n')).toThrow(
      /No package or import line/,
    );
  });
});

describe('with the configChanges fix (d147a99)', () => {
  it('leaves every MainActivity configChanges flag in place', () => {
    const manifest = {
      manifest: {
        $: {},
        application: [
          {
            $: { 'android:name': '.MainApplication' },
            activity: [
              {
                $: {
                  'android:name': '.MainActivity',
                  'android:configChanges':
                    'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize|assetsPaths',
                },
                'intent-filter': [
                  {
                    action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
                    category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    } as never;
    const result = setActivityConfigChanges(manifest) as unknown as {
      manifest: { application: { activity: { $: Record<string, string> }[] }[] };
    };
    const flags = result.manifest.application[0].activity[0].$['android:configChanges'].split('|');
    for (const flag of EXTRA_ACTIVITY_CONFIG_CHANGES) expect(flags).toContain(flag);
  });
});
