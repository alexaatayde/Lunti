# Lunti — Smart Personal Finance Management

A mobile app that turns grocery receipts into budgets, spending analytics, restock reminders and
meal ideas. Android first, PHP (₱).

Read [AGENTS.md](AGENTS.md) before contributing. It summarizes the approved SRS, SDD and SPMP in
[`docs/`](docs) and the UI handoff in [`design/`](design).

## Layout

```
AGENTS.md      build guide (stack, rules, data model, API surface)
docs/          LUNTI_SRS.pdf, LUNTI_SDD.pdf, LUNTI_SPMP.pdf
design/        UI handoff (DESIGN_HANDOFF.md, screens/, screenshots/, assets/)
apps/mobile/   React Native + TypeScript (Expo, Expo Router)
apps/api/      Python 3.13 + FastAPI
```

## Requirements

- Node.js 22.13+ or 24.3+ (React Native 0.88 requirement) and npm
- Python 3.13
- Expo Go on an Android phone, or an Android emulator

## Mobile app

```bash
cd apps/mobile
npm install
cp .env.example .env        # then fill in values
npx expo start              # press "a" for Android
npm run lint
npm run typecheck
npm test
```

If `.env` is missing the Supabase values, the app shows a "Lunti isn't connected yet" screen
instead of the sign-in flow.

### Supabase Auth setup (one time)

1. Create a project at https://supabase.com/dashboard (region close to the Philippines, e.g. Singapore).
2. **Project Settings → API**: copy the *Project URL* into `EXPO_PUBLIC_SUPABASE_URL` and the
   *anon / publishable* key into `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `apps/mobile/.env`.
   Never put the service-role / secret key in the mobile app.
3. **Authentication → Sign In / Providers → Email**: keep Email enabled. Set the minimum password
   length to 8 to match the app.
4. **Confirm email**: on by default. After sign-up the app shows "Check your email"; the user opens
   the link, then signs in. For quick local testing you can turn it off, which signs the user in
   straight away. In-app deep-link confirmation is not built yet.
5. Restart Expo (`npx expo start -c`) after changing `.env`.

## API

```bash
cd apps/api
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env        # then fill in DATABASE_URL and SUPABASE_URL
alembic upgrade head        # create/upgrade the database schema
uvicorn app.main:app --reload --host 0.0.0.0
```

- Health: http://localhost:8000/health · database: http://localhost:8000/health/db
- API docs (Swagger): http://localhost:8000/docs
- Every `/api/v1/*` route needs `Authorization: Bearer <Supabase access token>`.
- Lint: `ruff check .` · Tests: `pytest` (database tests are skipped unless `TEST_DATABASE_URL` is set)

### Database

- Migrations live in `alembic/versions`. Check the SQL before touching Supabase:
  `alembic upgrade head --sql` prints it without connecting.
- Each API request runs as the restricted `lunti_app_user` role with the caller's id set, so
  Row Level Security limits every query to that user's rows. Supabase's Data API roles
  (`anon`, `authenticated`) have no access to Lunti tables; the app goes through FastAPI.
- A trigger on `auth.users` creates each user's profile (with both consent times) and
  default preferences at sign-up. The migration also backfills users who already exist.

### Tests with a database

`TEST_DATABASE_URL` must point at a PostgreSQL 17 server where the user may create databases
and roles (a local server or Docker — **never Supabase**). The tests create a throwaway
database, load `tests/supabase_stub.sql`, migrate as a non-superuser and drop it afterwards.

```bash
docker run --rm -d -p 54329:5432 -e POSTGRES_PASSWORD=postgres --name lunti-pg postgres:17
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:54329/postgres pytest -rs
```

### Seed data (synthetic)

`scripts/seed.py` adds ~8 weeks of synthetic purchases, products and budgets for one user.
It only accepts an explicit `--database-url` (it never reads `DATABASE_URL`), refuses
non-local hosts unless `--allow-remote`, and only inserts rows with fixed ids, so it can be
re-run safely and never changes existing data.

```bash
# Local development database (migrated with alembic first):
python -m scripts.seed --database-url postgresql://postgres:postgres@localhost:54329/lunti_dev --create-demo-user
# A separate Supabase *development* project, for a user who signed up there:
python -m scripts.seed --database-url "<dev project URL>" --user-id <uuid> --allow-remote
```

### Receipt scanning (OCR and photo storage)

Receipt photos go to FastAPI, which stores them in a **private** Supabase Storage bucket and
reads them with **Google Cloud Vision**. The app never sees either credential. Nothing becomes
a transaction until the user taps "Save receipt" on the review screen.

One-time setup for real scanning:

1. **Google Cloud Vision.** In a Google Cloud project, enable the *Cloud Vision API* (billing
   must be on). Create a service account (no project role is needed to call Vision), add a
   JSON key, save it outside the repo, e.g. `~/.config/lunti/vision-key.json`, and set
   `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/vision-key.json` in `apps/api/.env`.
2. **Supabase Storage.** Dashboard → Storage → *New bucket*: name `receipts`, **Public off**,
   file size limit 10 MB, allowed types `image/jpeg, image/png, image/webp`. Add **no**
   storage policies: only the backend's service-role key can read or write it.
3. **Backend-only key.** Dashboard → Project Settings → API keys → copy the *service_role* /
   secret key into `SUPABASE_SERVICE_ROLE_KEY` in `apps/api/.env`. Never put it in
   `apps/mobile/.env` or any `EXPO_PUBLIC_*` variable.

Photos are stored as `receipts/{user_id}/{receipt_id}.{jpg|png|webp}`; the app only gets
10-minute signed URLs for its own receipts.

**Development without credentials.** Start the API with simulated adapters:

```bash
OCR_PROVIDER=fixture RECEIPT_STORAGE=local uvicorn app.main:app --reload --host 0.0.0.0
```

- `fixture` OCR only recognises the synthetic images in `tests/fixtures/receipts/*.png`
  (byte for byte) and returns their `.txt` text; any other photo reads as unreadable. The
  review screen labels these results "Simulated OCR (development)".
- `local` storage writes photos to `apps/api/var/receipts/` (git-ignored). Never use it with
  real user data.
- With `APP_ENV=production` both are refused, and missing credentials return a 503. The API
  never falls back from Google Vision or Supabase Storage to a development adapter.
- To try it on the Android emulator, copy the images into the gallery:
  `adb push tests/fixtures/receipts/zz-test-supermarket.png /sdcard/Pictures/` and pick it
  with *Gallery* on the scan screen. Regenerate them with
  `python -m scripts.make_receipt_fixtures` (needs Pillow).

`DATABASE_URL` tip: if the database password contains `@`, `:`, `/`, `#` or `%`, URL-encode
it (`@` → `%40`), otherwise the host is read wrongly and `/health/db` returns 503.

### Analytics and purchase patterns

`GET /api/v1/analytics/summary?period=daily|weekly|monthly` and `GET /api/v1/analytics/patterns`.
All figures are SQL sums of the user's transactions; dates are local to Asia/Manila.

- **Comparisons:** daily = today vs yesterday (7-day trend); weekly = Monday → today vs the same
  weekdays last week; monthly = the 1st → today vs the same days last month (clamped to a
  shorter month). Today isn't over, so the previous window stops at the same time of day
  (`compared_until`); the app says so under the comparison.
- **Patterns** come from confirmed receipt line items, counted per purchase day. Data tiers:
  fewer than 3 days = insufficient (no interval, nothing predicted), 3–4 = limited, 5+ =
  sufficient (`PATTERN_MIN_PURCHASES_LIMITED` / `PATTERN_MIN_PURCHASES_SUFFICIENT`).
  `confidence` is a heuristic consistency score (sample size × regularity of intervals), not a
  statistical probability. Labels: High confidence (sufficient, ≥ 0.6), Irregular timing
  (sufficient, < 0.6), Limited data, Insufficient data.
- **Product matching limitation:** line items match products by normalized name only (case,
  spacing and punctuation ignored; sizes kept, so "Rice 2kg" ≠ "Rice 5kg"). Variants and
  inconsistent receipt names ("Eggs (12)" vs "Eggs 1 tray", abbreviations, OCR misreads) become
  separate products, which splits their history. No fuzzy matching or merging yet.
- **Not built:** the design's "Recurring expenses" card (detection rules not approved yet).
- `python -m scripts.seed` also computes patterns for the seeded history.

### Mobile API client

After changing an endpoint: `python -m scripts.export_openapi` (apps/api), then
`npm run api:generate` (apps/mobile). CI fails if either file is stale.

On a phone, `localhost` is the phone itself: set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env`
to your computer's LAN address, e.g. `http://192.168.1.20:8000/api/v1`, and start uvicorn
with `--host 0.0.0.0`. The LAN address can change when your router reassigns it; if the
app shows "Can't reach Lunti", check it again. On the Android emulator, use
`http://10.0.2.2:8000/api/v1` instead (the emulator's alias for your computer), which never
changes. Restart Expo with `npx expo start -c` after editing `.env`.

## CI

`.github/workflows/ci.yml` runs on every pull request and push to `main`: mobile lint
(no warnings allowed), typecheck and Jest; API ruff and pytest. No secrets are needed.

## Secrets

Only `.env.example` files are committed. Backend keys (Supabase service role, Google Vision,
OpenAI, FCM) stay in `apps/api/.env` and never go in the mobile app.
