# Android builds (Phase 8D.1 groundwork)

Status: **configuration only.** No EAS project has been created, no build has run, no signing
credentials exist and nothing has been published. Every step marked *needs approval* below is
a decision for the project owner.

## Build variants

`APP_VARIANT` (set per profile in `apps/mobile/eas.json`) selects the variant in
`apps/mobile/app.config.ts`. Local runs (`expo start`, Expo Go, `expo run:android`) have no
`APP_VARIANT` and are **development**.

| Variant | EAS profile | Output | App name | Android package (provisional) | Link scheme | API address |
|---|---|---|---|---|---|---|
| development | `development` | dev-client APK, internal | Lunti Dev | `ph.lunti.app.dev` | `lunti-dev://` | may be local (`10.0.2.2`, LAN) |
| preview | `preview` | APK, internal | Lunti Preview | `ph.lunti.app.preview` | `lunti-preview://` | HTTPS, public host, required |
| production | `production` | AAB (Play Store) | Lunti | `ph.lunti.app` | `lunti://` | HTTPS, public host, required |

Separate packages and schemes let all three be installed side by side, and make a
password-reset link open the app that asked for it (the PKCE secret is stored there).
Non-production builds show "Development build" / "Preview build" on Profile → App → Version.

**`ph.lunti.app` is provisional.** The package name can't change after the first Play
upload: approve it before any production build.

## Environment safeguards

- Only `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  belong in the app. They are inlined into the JS bundle and readable by anyone with the APK.
- `app.config.ts` **refuses to configure a build** (so `eas build` / `expo run` fail) when:
  - any `EXPO_PUBLIC_*` variable is named like, or contains, a server secret (Supabase
    service-role or `sb_secret_` key, OpenAI key, private key, service-account JSON,
    database URL);
  - the Supabase key is a JWT whose role is not `anon`;
  - (preview/production) the API or Supabase URL is missing, not HTTPS, or a local/private
    address (localhost, `10.0.2.2`, `192.168.*`, `*.local`, …). There is no default address.
- The app repeats the same checks at startup (`src/lib/env.ts`) and shows the setup screen
  instead of connecting if they fail. A bundle without a variant stamp that isn't `__DEV__` is
  treated as production.
- `.env` is git-ignored, so EAS does not upload it. Release builds get their values from **EAS
  environment variables** for the profile's `environment` (`preview` / `production`), not from
  `eas.json` (which only sets `APP_VARIANT`). Running `eas build --profile preview` locally with a
  `.env` that points at `10.0.2.2` fails on purpose.
- Backend secrets (`SUPABASE_SERVICE_ROLE_KEY`, Vision, OpenAI, FCM) stay in `apps/api/.env`.

## Android permissions

Requested: `CAMERA` (receipt photos), `INTERNET`, `ACCESS_NETWORK_STATE`/`ACCESS_WIFI_STATE`
(offline detection), `POST_NOTIFICATIONS` + `RECEIVE_BOOT_COMPLETED` (expo-notifications),
`VIBRATE`.

Blocked in `app.config.ts` (`android.blockedPermissions`): microphone, legacy storage and
media-library permissions, location, `SYSTEM_ALERT_WINDOW`. Gallery picks use the system photo
picker, which needs no permission (expo-image-picker only checks permissions for its camera).

## Versioning

`eas.json` uses `appVersionSource: "remote"`: EAS stores `versionCode` and production builds
auto-increment it, so no version commits are needed. `expo.version` in `app.json` (1.0.0) is the
user-facing version and is changed by hand. No `runtimeVersion` (expo-updates isn't installed).

## Before the first native build (needs approval)

1. Approve the Android package names (or choose others).
2. Create the EAS project (`npx eas-cli@latest init`), which adds `extra.eas.projectId` and
   `owner` to the config. Free tier is enough for a few builds; a local build
   (`npx expo run:android`, Android Studio/JDK required) costs nothing.
3. Create EAS environment variables for `development`, `preview` and `production` (the three
   public values above). Preview/production need a deployed HTTPS API, which doesn't exist yet.
4. Add the reset redirect URLs to Supabase Auth → URL Configuration → Redirect URLs
   (`lunti-dev://reset-password`, `lunti-preview://reset-password`, `lunti://reset-password`).
   The live project was **not** changed in 8D.1.
5. Signing: let EAS generate and hold the Android keystore for internal builds. The upload
   key for Play is an irreversible decision; do not create it until approved.
6. Add a 96×96 white-on-transparent notification icon and set `icon` in the
   `expo-notifications` plugin (Android otherwise draws the app icon as a white square).

## Native-build checks to run once a dev/preview build exists

- **expo-crypto in an optimized build:** request a password reset in the preview APK and
  confirm the Supabase request uses `code_challenge_method=s256` (no "plain" warning), and that
  `secureCryptoAvailable()` is true.
- **Reset deep link:** open the email on the device; the link must open the matching variant
  and reach the new-password screen; an expired link shows the expired message.
- **Session persistence:** sign in, force-stop, relaunch → still signed in (expo-secure-store,
  Android Keystore-backed); sign out clears it.
- **Camera / gallery:** first-run permission prompt, "denied → Open settings", gallery pick on
  Android 13+ and on Android ≤ 12 (no storage permission is declared).
- **Android Back:** scan flow (`useHardwareBack`), modals, and tabs (`backBehavior` is still
  `initialRoute`, i.e. Back goes to Home; open decision).
- **Offline/reconnect:** airplane mode → offline strip, no queued writes; back online →
  refetch.
- **200 % font size:** Home (category names stacked, icon-only scan button), forms, nav.
- **Firebase (later subphase):** `google-services.json` (git-ignored) +
  `android.googleServicesFile`, FCM V1 credentials in EAS, backend `FCM_CREDENTIALS`. Until
  then push registration fails quietly and in-app notifications still work.
