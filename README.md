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

- Node.js 20+ and npm
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
```

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

## Secrets

Only `.env.example` files are committed. Backend keys (Supabase service role, Google Vision,
OpenAI, FCM) stay in `apps/api/.env` and never go in the mobile app.
