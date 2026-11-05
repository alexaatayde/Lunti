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
