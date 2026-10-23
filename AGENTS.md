# AGENTS.md — Lunti build guide for coding assistants

> Read this file fully before writing code. It summarizes the approved SRS, SDD and SPMP
> (`/docs`) and the UI design (`/design`). When this file and the docs disagree, **stop and ask**.

---

## 1. What we are building

**Lunti — Smart Personal Finance Management.** A mobile app that turns grocery receipts into
budgets, spending analytics, restock reminders and meal ideas.

- Primary user: an individual managing personal/household spending (Philippines; currency **PHP ₱**).
- Platform: **Android first** (SRS 2.4). Keep code cross-platform (Expo), but test on Android.
- Core loop: *scan or add a purchase → user confirms → budgets, analytics, patterns and pantry update → app nudges (alerts, restock, meals)*.

### Functional areas (SRS 3.1) → backend module

| SRS | Feature | Module |
|---|---|---|
| 3.1.1 | Expense management (manual add, edit, delete, search, filter) | `expenses` |
| 3.1.2 | Receipt scanning + OCR (draft → user confirms) | `receipts` |
| 3.1.3 | Budgets (daily/weekly/monthly/custom, per category, alerts) | `expenses` (budget part) |
| 3.1.4 | Spending analytics | `analytics` |
| 3.1.5 | Purchase-pattern tracking | `analytics` |
| 3.1.6 | Smart replenishment suggestions | `replenishment` |
| 3.1.7 | Smart shopping list | `replenishment` |
| 3.1.8 | Ingredient inventory (estimated pantry) | `meals` |
| 3.1.9 | Recipe recommendations | `meals` |
| 3.1.10 | AI insights (advisory only) | `insights` |
| 3.1.11 | Feedback & personalization | all modules (`feedback` table) |
| 3.5 | Auth, roles, privacy, account deletion | `auth` + Supabase Auth |
| 3.7.5 | Notifications | `notifications` |

---

## 2. Tech stack (SRS 2.5 — do not substitute)

| Layer | Technology |
|---|---|
| Mobile | **React Native + TypeScript**, **Expo** (EAS Build), Expo Router |
| Local state | **Zustand** |
| Server state | **TanStack Query** |
| Icons/graphics | `react-native-svg` (paths in `/design/screens/NavBar.html`) |
| Camera | `expo-camera` + `expo-image-picker` (gallery) |
| Backend | **Python 3.13 + FastAPI**, SQLAlchemy 2 + Alembic, Pydantic v2 |
| Database | **PostgreSQL on Supabase** |
| Auth | **Supabase Auth** (email + password) |
| File storage | **Supabase Storage** (receipt images, private bucket) |
| OCR | **Google Cloud Vision API** (document text detection) |
| AI | **OpenAI API** (insights wording, recipe reasoning) — never for money math |
| Push | **Firebase Cloud Messaging** (via `expo-notifications` device token) |
| API docs | FastAPI OpenAPI / Swagger at `/docs` |
| Tests | Jest + React Native Testing Library (mobile), Pytest (API) |
| VCS | Git + GitHub |

---

## 3. Architecture (SDD 3)

```
React Native app  ──HTTPS + Supabase JWT──▶  FastAPI (modular monolith)  ──▶ PostgreSQL (Supabase)
       │                                         │   ├─ Supabase Storage (receipt images)
       └── Supabase Auth (sign up / sign in)     │   ├─ Google Cloud Vision (OCR)
                                                 │   ├─ OpenAI (advisory text)
                                                 │   └─ Firebase Cloud Messaging (push)
```

- **The app talks only to FastAPI** for data. It uses Supabase directly **only for auth**
  (sign up, sign in, session refresh) and, optionally, signed uploads to Storage.
- **FastAPI verifies the Supabase JWT on every request** and scopes every query to `user_id`.
- **Modular monolith:** one FastAPI app, one package per domain module. A module owns its tables;
  other modules call its service functions, never its tables directly.
- A confirmed receipt updates transactions, line items, budgets and purchase patterns in
  **one database transaction** (SDD 3.2).

---

## 4. Non-negotiable rules

1. **Confirmation-gated writes.** OCR output and AI suggestions are *drafts*. Nothing is written to
   authoritative tables (transactions, shopping list, inventory) until the user confirms or acts.
2. **Deterministic money.** Budget totals, remaining balances and analytics are computed by backend
   code / SQL aggregation. Store money as `NUMERIC(12,2)` in Postgres and `Decimal` in Python;
   never floats. The AI never produces or alters a financial figure.
3. **AI is advisory and grounded.** Send OpenAI only a pre-computed summary; instruct it to use only
   that data; check every number in the reply against the summary before showing it. If data is
   insufficient, return a "need more data" placeholder instead of calling the model.
4. **Recalculate budgets** after every transaction create, confirm, edit or delete.
5. **Data tiers (SRS 3.6.2):** patterns and suggestions report `sufficient`, `limited` or
   `insufficient` data; never show a confident prediction on insufficient data.
6. **Privacy (SRS 3.5, RA 10173 Data Privacy Act):** a user can only read/write their own rows;
   receipt images are private; sign-up records both consents; account deletion removes user data
   per the retention policy. Strip personal identifiers from anything sent to OpenAI.
7. **Never expose secrets in the app.** Supabase service-role key, Vision and OpenAI keys live only
   in the backend environment.
8. **UX feedback (SRS 3.2.3, 3.3.2, 3.4):** every action shows loading → success/error; failures
   offer retry; OCR failure offers *Try again / Choose another image / Enter manually*.
9. **Accessibility (SRS 3.2.4):** touch targets ≥ 44–48 dp, labels on icon buttons, status never
   conveyed by color alone.

---

## 5. Repository layout

```
/
├─ AGENTS.md                 ← this file
├─ docs/                     ← LUNTI_SRS.pdf, LUNTI_SDD.pdf, LUNTI_SPMP.pdf
├─ design/                   ← UI handoff (DESIGN_HANDOFF.md, screens/, screenshots/, assets/)
├─ apps/
│  ├─ mobile/                ← Expo app
│  │  ├─ app/                ← Expo Router routes (see §8)
│  │  ├─ src/theme.ts        ← tokens from design/DESIGN_HANDOFF.md §1
│  │  ├─ src/components/     ← shared UI (AppHeader, BottomNav, Card, Button, …)
│  │  ├─ src/features/<area>/← screens' hooks, API calls, view models per feature
│  │  ├─ src/api/            ← typed API client (generated from OpenAPI) + TanStack Query hooks
│  │  ├─ src/stores/         ← Zustand stores (session, scan draft, UI)
│  │  └─ src/lib/            ← supabase client, money/date formatters
│  └─ api/                   ← FastAPI
│     ├─ app/main.py
│     ├─ app/core/           ← config, db session, auth (JWT verify), errors
│     ├─ app/modules/
│     │  ├─ expenses/        ← transactions, categories, budgets
│     │  ├─ receipts/        ← upload, OCR, parse, confirm
│     │  ├─ analytics/       ← spending summaries, purchase patterns
│     │  ├─ replenishment/   ← suggestions, shopping lists
│     │  ├─ meals/           ← inventory, recipes, matching
│     │  ├─ insights/        ← OpenAI prompting + sanitizing
│     │  ├─ notifications/   ← FCM dispatch, notification records
│     │  └─ users/           ← profile, preferences, consent, account deletion
│     │     (each module: models.py, schemas.py, service.py, router.py, tests/)
│     ├─ app/jobs/           ← scheduled jobs (§7.6)
│     └─ alembic/
└─ .github/workflows/        ← lint + test on PR
```

---

## 6. Data model (SDD 4.2, with clarifications)

All tables: `id UUID PK`, `created_at`, `updated_at`. Every user-owned table has `user_id UUID`
referencing `auth.users(id)` and is filtered by it in every query.

| Table | Key columns |
|---|---|
| `profiles` | `user_id` (PK = auth.users.id), `full_name`, `role` (`user`/`admin`), `currency` (`PHP`), `terms_accepted_at`, `data_consent_at` |
| `user_preferences` | `user_id`, notification toggles (budget, replenishment, shopping, meals), `budget_alert_pct` (default 90) |
| `categories` | `user_id` (NULL = default), `name`, `is_default`, `icon` |
| `transactions` | `user_id`, `category_id`, `amount NUMERIC(12,2)`, `occurred_at`, `merchant`, `note`, `source` (`manual`/`receipt`), `receipt_id` NULL |
| `transaction_line_items` | `transaction_id`, `product_id` NULL, `name`, `quantity NUMERIC`, `unit` , `unit_price`, `discount`, `tax`, `line_total` |
| `receipts` | `user_id`, `image_path`, `ocr_raw_text`, `ocr_status` (`processing`/`draft`/`failed`/`confirmed`), `confidence_store`, `confidence_items`, `confidence_total`, `confirmed_at` |
| `budgets` | `user_id`, `category_id` NULL (= overall), `period_type` (`daily`/`weekly`/`monthly`/`custom`), `start_date`, `end_date`, `limit_amount`, `alerts_enabled`, `last_alert_level` (`none`/`near`/`exceeded`) |
| `products` | `user_id`, `name`, `normalized_name`, `is_food`, `default_category_id`, `default_unit` |
| `purchase_patterns` | `user_id`, `product_id`, `avg_interval_days`, `interval_stddev_days`, `purchase_count`, `last_purchased_at`, `confidence_score`, `data_tier` |
| `replenishment_suggestions` | `user_id`, `product_id`, `pattern_id`, `predicted_date`, `confidence_score`, `status` (`pending`/`added`/`dismissed`/`modified`) |
| `shopping_lists` / `shopping_list_items` | items: `name`, `quantity`, `unit`, `est_price`, `is_purchased`, `source` (`manual`/`suggested`/`recipe`), `product_id` NULL, `recipe_id` NULL |
| `ingredient_inventory` | `user_id`, `product_id`, `estimated_quantity`, `unit`, `estimated_expiry`, `confirmed_by_user` |
| `recipes` / `recipe_ingredients` | recipe: `name`, `servings`, `prep_time_minutes`; ingredient: `name`, `product_id` NULL, `quantity_required`, `unit` |
| `insights` | `user_id`, `type`, `message`, `source_figures JSONB`, `generated_at`, `dismissed` |
| `feedback` | `user_id`, `target_type`, `target_id`, `action` (`add_to_list`/`still_have`/`bought_elsewhere`/`dont_remind`/`dismiss`/`modify`) |
| `notifications` | `user_id`, `type`, `payload JSONB`, `deep_link`, `sent_at`, `read_at` |
| `device_tokens` | `user_id`, `fcm_token`, `platform` |

Clarifications vs SDD (flag in PR descriptions): no `password_hash` (Supabase Auth owns credentials);
`unit` added to quantities so recipe matching works; categories can be user-owned; confidence and
stddev fields added because the algorithms below need them.

Enable **Row Level Security** on all user tables (`user_id = auth.uid()`) as defense in depth, even
though the API also filters by user. The API's DB role must respect RLS or apply the same filter in
every query — never use the service role for user-scoped reads without a `user_id` filter.

---

## 7. Core logic (SDD 5) — implement exactly, unit-test thoroughly

### 7.1 Receipt pipeline (`receipts`)
1. `POST /receipts` (multipart image) → store in private bucket `receipts/{user_id}/{uuid}.jpg`,
   create `receipts` row `ocr_status=processing`.
2. Call Vision `DOCUMENT_TEXT_DETECTION`. On error or low confidence → `failed`; app shows Scan failed screen.
3. Parse merchant, date/time, line items (name, qty, unit price), discount, VAT (PH receipts are
   12 % VAT-inclusive), total. Compute per-field confidence. Return **draft** (no transaction yet).
4. `POST /receipts/{id}/confirm` with the user-edited draft → validate (required fields, amounts ≥ 0,
   line items sum to total within ±0.01 after discount) → **single DB transaction**: create
   transaction + line items, mark receipt `confirmed`, recalc budgets (7.2), update patterns (7.3),
   update inventory for food items (7.5).

### 7.2 Budget status (`expenses`)
For each active budget covering the transaction date: `spent = SUM(amount)` in period (and category
if set); `remaining = limit − spent`. `remaining ≤ 0` → *exceeded*; `spent ≥ 90 % of limit` → *near*.
Send a notification only when the level rises (`last_alert_level`) to avoid duplicate alerts; reset
when an edit/delete brings it back down. Run on create, confirm, edit and delete.

### 7.3 Purchase patterns (`analytics`)
Match line items to `products` by normalized name. Per product: intervals between consecutive purchase
dates → mean and stddev. Defaults (configurable, propose in PR): `purchase_count < 3` → `insufficient`;
3–4 → `limited`; ≥ 5 → `sufficient`. `confidence = f(sample size, 1 − coefficient of variation)` in 0–1.

### 7.4 Replenishment (`replenishment`)
Skip patterns with `confidence < 0.6` (default). `predicted = last_purchased_at + avg_interval_days`.
If `predicted − today ≤ 3 days` (approach window, default) → upsert `pending` suggestion. User actions
write `feedback`: *Add to list* → shopping item; *Still have some* → push prediction later;
*Bought elsewhere* → treat as a purchase; *Don't remind* → mute product; *Modify* → user date/qty.

### 7.5 Pantry + recipe matching (`meals`)
Inventory is **estimated** from confirmed food purchases and shown as such until the user confirms.
`match = available required ingredients / total required` (unit-aware). Estimated cost of missing
ingredients = user's last/average paid price for that product, else catalog price. Rank by match,
filter by remaining food budget. "Add missing to list" creates `source=recipe` shopping items.
Recipe catalog is **seeded** (migration + admin-only endpoint) — not user-generated.

### 7.6 Scheduled jobs (`app/jobs`) — gap in SDD, implement with APScheduler in the API process
- Daily 06:00 Asia/Manila: recompute replenishment suggestions, send restock + shopping reminders.
- Daily: expire-soon pantry nudges, meal recommendation (respect user preferences).

### 7.7 Insights (`insights`)
Build a numeric summary (category totals, month-over-month, budget status, top patterns). If too
little data → placeholder. Else prompt OpenAI with the summary only; reject/repair any reply whose
numbers are not in the summary; store message + `source_figures`.

---

## 8. Mobile app

### Navigation (Expo Router) — matches `/design/DESIGN_HANDOFF.md` §4
```
app/
  (auth)/welcome.tsx  sign-in.tsx  sign-up.tsx
  (tabs)/_layout.tsx   ← custom BottomNav: Analytics · Budget · Home · Meals · Transactions
  (tabs)/analytics.tsx  budget/index.tsx  home.tsx  meals/index.tsx  transactions/index.tsx
  meals/pantry.tsx  meals/grocery-list.tsx
  budget/new.tsx  profile.tsx  notifications.tsx
  transactions/[id].tsx                        ← detail (keeps bottom nav)
  (modals)/scan/camera.tsx  scan/review.tsx  scan/failed.tsx
  (modals)/expense-form.tsx?mode=add|edit&id=  ← add / edit
  (modals)/add-transaction.tsx  category-picker.tsx   ← bottom sheets
```
Redirect to `(auth)/welcome` when there is no Supabase session.

### Conventions
- **UI:** build every screen from `/design` (screenshot = look, `screens/*.html` = exact values).
  Use only `src/theme.ts` tokens; no hard-coded colors. Fonts: Inter (Android) / SF (iOS).
- **Data:** all server data via TanStack Query hooks in `src/api`; invalidate `transactions`,
  `budgets`, `analytics`, `patterns` after any transaction mutation. Zustand only for session,
  the in-progress scan draft and UI state.
- **Money:** amounts arrive as strings from the API; format with one `formatMoney()` (₱, 2 decimals).
- **Forms:** `react-hook-form` + `zod`; mirror backend validation.
- **States:** every screen handles loading (skeleton), empty, error (retry) and offline.
- **Toasts:** "Transaction saved. Budget updated." / "Transaction deleted. Budget updated." + Undo.

---

## 9. API surface (`/api/v1`, all require `Authorization: Bearer <supabase jwt>`)

```
GET  /me                      PATCH /me            DELETE /me (account deletion)
GET  /me/preferences          PUT   /me/preferences
POST /devices                 (register FCM token)

GET  /categories              POST /categories     PATCH/DELETE /categories/{id}
GET  /transactions?from&to&category_id&q&cursor
POST /transactions            GET/PATCH/DELETE /transactions/{id}

POST /receipts                (upload → draft)     GET /receipts/{id}
POST /receipts/{id}/confirm   (draft → transaction)

GET  /budgets                 POST /budgets        PATCH/DELETE /budgets/{id}
GET  /budgets/status          (spent, remaining, level per active budget)

GET  /analytics/summary?period=daily|weekly|monthly
GET  /analytics/patterns

GET  /replenishment/suggestions          POST /replenishment/suggestions/{id}/feedback
GET  /shopping-lists                     POST /shopping-lists/{id}/items
PATCH/DELETE /shopping-lists/{id}/items/{item_id}

GET  /pantry                  PATCH /pantry/{id}   (confirm/adjust estimate)
GET  /recipes/recommendations GET /recipes/{id}    POST /recipes/{id}/add-missing

GET  /insights                POST /insights/{id}/dismiss
GET  /notifications           POST /notifications/{id}/read
```
Errors: RFC 7807 JSON (`type`, `title`, `detail`, `errors[]`). Generate the TS client from OpenAPI.

---

## 10. Environment

`apps/api/.env`: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`,
`GOOGLE_APPLICATION_CREDENTIALS`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `FCM_CREDENTIALS`, `TZ=Asia/Manila`.
`apps/mobile/.env`: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
Commit `.env.example` files only.

---

## 11. Testing & definition of done

- Pytest: every rule in §4 and every algorithm in §7 (budget thresholds, pattern tiers, replenishment
  window, recipe match, receipt confirm atomicity, user isolation). Target ≥ 80 % on `modules/*/service.py`.
- Jest + RNTL: shared components, forms, the scan review screen, navigation guards.
- Seed script with **synthetic purchase history** (several weeks) so patterns/replenishment can be
  demoed and tested within the project timeline.
- A task is done when: it matches the design screenshot, handles loading/empty/error, has tests,
  passes lint/typecheck, and the PR lists the SRS section it satisfies.

---

## 12. Build order (fits the SPMP 12-week plan)

1. Repo scaffold, CI, `theme.ts`, shared components, navigation skeleton, Supabase project + auth.
2. Data model + migrations + seed; `/me`, categories.
3. Expenses + budgets (manual add/edit/delete, budget status, toasts) → Transactions flow T1–T7.
4. Receipt pipeline (camera, upload, OCR, review, confirm, failure path).
5. Analytics + purchase patterns.
6. Replenishment, shopping list, notifications + scheduled jobs.
7. Pantry, recipes, insights.
8. Hardening: offline/error states, accessibility pass, security review, EAS build.

Work in small PRs, one feature area at a time. **Stop for review** after step 1 and after each feature area.

---

## 13. Open decisions — ask the team, do not guess

- iOS in scope or Android only? (SRS says Android; SPMP mentions iOS.)
- Final threshold values (§7.3–7.4 defaults are proposals).
- Receipt review button label: proposed "Save & add to pantry".
- Recipe catalog source and size for the MVP.
- Data-retention period after account deletion (SRS 3.5.5).
- Not yet designed: forgot/reset password, OCR processing screen, recipe detail, insights feed,
  notifications entry point. Build simple versions in the existing style and flag them in the PR.
