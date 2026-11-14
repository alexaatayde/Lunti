/**
 * Dynamic app config. `app.json` holds the shared values; this file applies the build variant
 * (APP_VARIANT = development | preview | production, set per profile in eas.json) and refuses
 * to configure a build whose public env is unsafe (see src/config/buildEnv.ts).
 *
 * Local runs (`expo start`, Expo Go, `expo run:android`) have no APP_VARIANT and are
 * development builds.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

import {
  VARIANT_IDENTITY,
  buildEnvProblems,
  isReleaseVariant,
  parseVariant,
} from './src/config/buildEnv.ts';

/**
 * Permissions some dependency may merge into the manifest that Lunti never uses. Camera is
 * the only dangerous permission the app needs (receipt photos); gallery picks go through the
 * system photo picker, and notifications ask at runtime on Android 13+.
 */
const BLOCKED_ANDROID_PERMISSIONS = [
  'android.permission.RECORD_AUDIO',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
  'android.permission.ACCESS_MEDIA_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.SYSTEM_ALERT_WINDOW',
];

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = parseVariant(process.env.APP_VARIANT);
  const identity = VARIANT_IDENTITY[variant];

  const problems = buildEnvProblems(variant, process.env);
  if (problems.length > 0) {
    throw new Error(
      `Lunti ${variant} build is not safely configured:\n- ${problems.join('\n- ')}\n` +
        'Set the values for this environment (EAS environment variables or apps/mobile/.env) ' +
        'and try again.',
    );
  }

  return {
    ...config,
    name: identity.name,
    slug: config.slug ?? 'lunti',
    scheme: identity.scheme,
    android: {
      ...config.android,
      package: identity.androidPackage,
      blockedPermissions: BLOCKED_ANDROID_PERMISSIONS,
    },
    plugins: [
      ...(config.plugins ?? []),
      [
        'expo-notifications',
        {
          // theme.ts colors.primary. A white silhouette `icon` is still needed (see docs/android-build.md).
          color: '#539E2F',
          // Matches the channel push.ts creates.
          defaultChannel: 'default',
        },
      ],
    ],
    extra: {
      ...config.extra,
      appVariant: variant,
      environmentLabel: identity.label,
      releaseBuild: isReleaseVariant(variant),
    },
  };
};
