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

### Restock suggestions, grocery list and notifications

- **Suggestions** (`/replenishment/suggestions`): only products with a *sufficient* pattern
  (5+ purchase days) and confidence ≥ 0.6. Predicted date = last purchase (or "bought
  elsewhere" day) + average interval; shown when it's 3 days away or less (overdue included).
  Answers: Add to list, I still have some (+ max(3, interval ÷ 2) days), Bought elsewhere
  (cycle restarts today, no transaction), Don't remind (product muted, with Undo; muted items
  can be turned back on from Notifications → Muted items, `GET/DELETE /replenishment/muted`),
  Not now, Change date or quantity. One answered suggestion per product and purchase cycle;
  unmuting reopens the same suggestion (same reminder key), so nothing is sent twice.
  Settings: `REPLENISHMENT_MIN_CONFIDENCE`, `REPLENISHMENT_WINDOW_DAYS`, `STILL_HAVE_MIN_DAYS`.
- **Grocery list** (`/shopping-lists`): one list per user; totals and the Groceries (else
  overall) budget check are computed by the API. An unbought item with the same name can't be
  added twice.
- **Notifications** (`/notifications`, `/devices`): budget alerts (when a level rises),
  restock reminders and a daily shopping reminder, each behind its preference switch.
  Notifications are stored first and pushed after commit by the dispatcher.
- **Scheduled jobs:** set `SCHEDULER_ENABLED=true` for the API process. Daily at 06:00
  Asia/Manila (`DAILY_JOB_HOUR`) it refreshes suggestions and stores reminders; every minute
  it pushes unsent notifications. Re-runs and multiple workers are safe (advisory lock,
  de-duplication keys, `SKIP LOCKED`).
- **Migration `0002_replenishment_notifications`** (additive, one transaction: two nullable
  suggestion columns + a check, a notification key + unique index, a device-token function;
  nothing is dropped or rewritten). Review the SQL first, then apply from `apps/api`:

  ```bash
  .venv/bin/alembic -x url=postgresql://offline/x upgrade 0001_initial_schema:head --sql
                                                    # print 0002's SQL only (no connection)
  .venv/bin/alembic current                         # expect 0001_initial_schema
  .venv/bin/alembic upgrade head                    # uses DATABASE_URL from apps/api/.env
  ```

  Rollback (drops the new columns' values): `.venv/bin/alembic downgrade 0001_initial_schema`.

**Push setup (not configured yet).** Without it, everything works except delivery to the phone.

1. Choose the Android package name (`android.package` in `apps/mobile/app.json` isn't set
   yet), then Firebase console → add a project → add an Android app with that package →
   download `google-services.json`.
2. Mobile: put the file in `apps/mobile/`, add `"googleServicesFile": "./google-services.json"`
   under `android` in `app.json`, and make a development build (`npx expo run:android` or EAS).
   Expo Go can't receive remote push on Android (SDK 53+).
3. Backend: Project settings → Service accounts → generate a private key, store it outside the
   repo, set `FCM_CREDENTIALS=/absolute/path/firebase-key.json` in `apps/api/.env`.

### Pantry, recipes and insights

- **Pantry** (`/pantry`): confirmed receipt items in a *Groceries* transaction add their
  quantity as an **estimate**; no automatic decrease; deleting that receipt takes it back off
  unconfirmed items. Setting an amount (−/+ or edit) confirms it. Expiry is only user-set.
- **Recipes** (`/recipes/recommendations`, `/recipes/{id}`, `/recipes/{id}/add-missing`):
  match = available ÷ required ingredients (names matched word by word; g↔kg and ml↔L
  converted; an amount that can't be compared counts as available but is flagged "check
  amount"). Missing-item cost = what the user last paid, otherwise unknown. Recipes whose known
  missing cost exceeds the Groceries budget left are hidden (and counted).
- **Catalog**: migration `0003_recipe_catalog` seeds 20 Filipino home recipes (data only).
  Admins (`profiles.role = 'admin'`) add more with `POST /api/v1/admin/recipes`.
  Review, then apply from `apps/api` (needs approval for the live database):

  ```bash
  .venv/bin/alembic -x url=postgresql://offline/x upgrade 0002_replenishment_notifications:head --sql
  .venv/bin/alembic upgrade head
  ```

- **Insights** (`/insights`): figures come from the analytics and budget services. With
  `OPENAI_API_KEY` and `OPENAI_MODEL` set, OpenAI words them (only the figures are sent; custom
  category names are replaced) and any reply containing a number not in the figures is
  discarded for the template. Without them, a fixed template writes the same figures
  ("Summary"). Fewer than `INSIGHTS_MIN_TRANSACTIONS` (5) this + last month → "need more data".
  At most one generation per user per day.
- **Daily job** additions (behind `notify_meals`): "Use these first" for pantry items whose
  user-set date is within `PANTRY_EXPIRING_DAYS` (3), and a meal idea when the best recipe
  matches at least `MEAL_IDEA_MIN_MATCH_PCT` (80 %).

### API security (Phase 8B)

- **Idempotent expense saves.** `POST /api/v1/transactions` takes an `Idempotency-Key` header
  (8–128 of `A-Z a-z 0-9 _ -`). The app sends one key per intended expense and reuses it for
  every attempt, so a save that timed out after the server recorded it is never doubled: a
  repeat with the same data returns the saved transaction (200, `Idempotent-Replayed: true`,
  no new budget alerts); the same key with different data gets 422
  (`idempotency-key-reused`); a retry after that transaction was deleted gets 409. Keys are
  per user (table `idempotency_keys`, migration 0004, RLS). The header is optional on the
  server for now (older clients); the app always sends it.
  **Key retention: keys are kept (no pruning) until a retention policy is approved.** Each row
  holds only the user, scope, key, a SHA-256 of the request and the transaction link; rows go
  with the account (ON DELETE CASCADE) and are RLS-protected. Pruning too early is unsafe:
  once a key is gone, a delayed retry of its request (a phone that was offline, a request
  queued by the OS, a slow network replaying it) is treated as new, so it records the expense
  again — and if the user had deleted that expense, it quietly comes back, since the key's
  "deleted" marker (`transaction_id` NULL → 409) is what blocks it. Any future retention
  period must be far longer than any client could retry, and the app must never reuse a key
  after that period.
- **Rate limits** (429 + `Retry-After`) per signed-in user and endpoint: receipt upload, receipt
  confirm and transaction create (`RATE_LIMIT_*` in `.env.example`).
  **Deployment requirement: run ONE API process** (one uvicorn worker, one instance). Counts
  are kept in that process's memory: with several workers or instances each keeps its own
  counts (the effective limit multiplies), and a restart resets them. Scaling out needs a
  shared store (e.g. a Postgres table or Redis) first. The scheduler has the same
  one-process assumption (its jobs are also guarded by advisory locks).
- **Body size**: requests over `REQUEST_MAX_BYTES` (receipt photos: `RECEIPT_MAX_BYTES` + 64 KB)
  get 413 before they are read in full.
- **Logs**: one access line per request (method, route template, status, duration, request id;
  `X-Request-ID` is returned). No query strings, headers, tokens or bodies; secrets, e-mail
  addresses and URL queries are masked in every line. `APP_ENV=production` logs JSON and drops
  exception messages from tracebacks; SQL parameter values are hidden unless
  `LOG_SQL_PARAMETERS=true`.
- **API docs** (`/docs`, `/redoc`, `/openapi.json`) are served only outside production. The
  mobile client is generated from `app.openapi()` (`python -m scripts.export_openapi`), which
  works in every environment.

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
