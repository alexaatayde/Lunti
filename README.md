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
cp .env.example .env        # then fill in values
uvicorn app.main:app --reload
```

- Health check: http://localhost:8000/health
- API docs (Swagger): http://localhost:8000/docs
- Tests and lint: `pytest` and `ruff check .`

## CI

`.github/workflows/ci.yml` runs on every pull request and push to `main`: mobile lint
(no warnings allowed), typecheck and Jest; API ruff and pytest. No secrets are needed.

## Secrets

Only `.env.example` files are committed. Backend keys (Supabase service role, Google Vision,
OpenAI, FCM) stay in `apps/api/.env` and never go in the mobile app.
