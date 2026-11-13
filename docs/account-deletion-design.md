# Account deletion — design proposal (Phase 8A, for review)

Status: **proposal only. Nothing destructive is implemented or enabled.** `DELETE /api/v1/me`
does not exist yet. No live account has been deleted.

Decision recorded: **Option A — immediate deletion** of the account and its live data
(SRS 3.5.5, RA 10173). Open item: the retention period for backups and logs (AGENTS.md §13).

---

## 1. What exists today (verified)

### 1.1 Database (verified on a throwaway database, `tests/test_account_deletion_cascade.py`)

- 15 tables have a `user_id`: budgets, categories, device_tokens, feedback,
  ingredient_inventory, insights, notifications, products, profiles, purchase_patterns,
  receipts, replenishment_suggestions, shopping_lists, transactions, user_preferences.
- Every one references `auth.users(id) ON DELETE CASCADE` (checked in `pg_constraint`).
- Two child tables are removed through their parent: transaction_line_items (→ transactions),
  shopping_list_items (→ shopping_lists).
- Deleting the `auth.users` row as `supabase_auth_admin` (what the Auth Admin API does)
  removed every row of the user in all 17 tables, including a custom category that a
  transaction and a budget still referenced (`ON DELETE RESTRICT` between those tables did not
  block the cascade). Another user's rows and the shared recipe catalog were untouched.
- The tests fail if a new `user_id` table is added without being listed and cascading.
- A token of a deleted user stays cryptographically valid until it expires (≤ 1 h). Reads
  return nothing (rows are gone; RLS + `user_id` filters). `/me` already answers
  **401 "This account no longer exists."** when the profile insert hits the missing
  `auth.users` row; the app then fails to refresh (user gone) and signs out with
  "Your session ended" (Phase 8A session handling).

### 1.2 Outside the database — not covered by the cascade

| Data | Where | Removed by cascade? | Plan |
|---|---|---|---|
| Receipt photos | Supabase Storage `receipts/{user_id}/…` (dev: local folder) | **No** | Delete the user's folder after the auth delete (§3 step 6). Backstop: the existing daily orphan sweep (`app/jobs/receipt_cleanup.py`) deletes any photo not referenced by `receipts.image_path` after 24 h. |
| Auth identities, sessions, refresh tokens, MFA factors | Supabase `auth` schema | Yes (Supabase cascades inside `auth`) | — |
| Auth audit log (`auth.audit_log_entries`: email, IP, actions) | Supabase | **No** | Supabase-managed retention; document in the Privacy Notice. |
| Push tokens at Firebase | FCM | n/a (FCM keeps no user record; our `device_tokens` rows cascade) | Nothing to call; tokens are simply never used again. |
| OCR images | Google Cloud Vision | n/a | Online `DOCUMENT_TEXT_DETECTION` requests are not stored by Google per its data-use terms (confirm for the project's terms). |
| Insight prompts | OpenAI API | n/a | Only pre-computed figures, no identifiers (AGENTS.md §4.6). OpenAI may retain API inputs up to 30 days for abuse monitoring unless zero-retention is arranged. |
| Password-reset / confirmation emails | Supabase mailer / SMTP provider logs | No | Provider retention; document. |
| Database backups | Supabase automated backups (plan-dependent; typically 7 days on Pro, PITR longer) | No | Data ages out with the backup window. A restore must re-apply deletions (keep the deletion log, §3.8). |
| **Manual backups** | `~/Desktop/Lunti-db-backups/*.dump/.sql` (taken before migrations) | **No** | Contain real user data indefinitely. **Needs a retention rule** (e.g. delete 30 days after the migration is verified) — decision needed. |
| API/access logs | Hosting provider (not chosen yet) | No | Phase 8B privacy-safe logging: no emails, tokens or bodies; user IDs only where needed; fixed retention. |

## 2. Requirements

1. Only the signed-in user can delete **their own** account (user id comes from the verified
   JWT; no id in the URL or body).
2. **Recent re-authentication**: the user re-enters their password right before deleting.
3. A clear, explicit warning and a deliberate confirmation step.
4. No accidental, repeated or concurrent deletions.
5. All-or-nothing for the authoritative data; best-effort plus a sweep for files.
6. Recoverable failures leave the account fully intact and retryable.
7. No personal data in logs.

## 3. Proposed flow

### 3.1 App (Profile → "Delete account")

1. Profile gets a "Delete account" row (danger style, icon + text, 48 dp).
2. **Warning screen** lists exactly what is deleted (transactions, receipts and photos, budgets,
   lists, pantry, insights, notifications, preferences) and that it **cannot be undone**; links
   to the retention note (backups age out within N days).
3. Confirm step: password field + the user types `DELETE`. Button disabled until both are filled.
4. On confirm, the app **re-authenticates** with Supabase (`signInWithPassword` with the current
   email and the entered password). Wrong password → field error; nothing else happens.
5. Calls `DELETE /api/v1/me` with `{ "confirm": "DELETE" }` and an `Idempotency-Key`.
6. On success (204): unregister nothing (tokens are gone), clear the TanStack cache, sign out
   locally as an *intended* sign-out, and show Welcome with "Your account was deleted."
7. On failure: network/503 → "Your account was not deleted. Try again." (retry); 409 → "Already
   in progress"; 401 `reauth_required` → back to the password step.

### 3.2 API: `DELETE /api/v1/me`

1. **Auth** as usual (`CurrentUserDep`), user id from `sub`.
2. **Recent password check** from the Supabase JWT `amr` claim: require an entry with
   `method == "password"` and `timestamp ≥ now − 5 min`. (`iat` is not enough: it changes on
   every refresh; `amr` keeps the original sign-in time.) Recovery/magic-link sessions do not
   qualify. Otherwise **401** `reauth_required`.
3. Body must be `{"confirm": "DELETE"}` → else **422**.
4. **Single flight**: `pg_try_advisory_lock(hashtext('lunti:delete-account:' || user_id))`; if
   taken → **409**. Rate limit 3/hour/user (Phase 8B limiter).
5. **Collect** the user's `receipts.image_path` values (needed after the rows are gone).
6. **Point of no return — Supabase Auth Admin API**:
   `DELETE {SUPABASE_URL}/auth/v1/admin/users/{user_id}` with the service-role key,
   `should_soft_delete: false`. The DB cascade happens inside that single statement, so either
   everything is deleted or nothing is.
   - 404 → already deleted → treat as success (idempotent repeat).
   - Network error / 5xx / timeout → **503** "Your account was not deleted"; nothing changed.
   - Ambiguous timeout: before answering 503, re-check `auth.users`; if the row is gone, continue.
7. **Files**: delete every collected path, then list `receipts/{user_id}/` and delete anything
   left. Failures are logged (count only) and left to the daily orphan sweep (≤ 48 h).
8. **Deletion log** (needs a migration — approval required): `account_deletions(id,
   user_id_hash, requested_at, completed_at, files_pending)` with **no** email/name, kept so a
   backup restore can re-apply deletions and so the deletion can be evidenced under RA 10173.
9. Respond **204**.

Why auth-first rather than "delete our rows, then auth": if the Admin call fails after our rows
are gone, the user would have a working login and an empty account; auth-first makes the Admin
call the single atomic step, and files are the only best-effort part (with a sweep behind them).

### 3.3 Configuration and safety switches

- `SUPABASE_SERVICE_ROLE_KEY` in the backend environment only (currently empty).
- `ACCOUNT_DELETION_ENABLED=false` by default; the endpoint returns 503 "not available" until
  enabled per environment. The app hides the row when `/me` reports it unavailable.
- The Admin client is an injectable dependency so tests never call Supabase.

## 4. Tests to add when implementing

- Unit: `amr` recent-auth parsing (password vs recovery vs stale vs missing claim); confirm
  phrase; disabled flag.
- Fake Admin client: success → 204, rows gone (throwaway DB), files deleted; Admin 5xx →
  503 and **every row and file still present**; 404 → 204 (idempotent); concurrent call → 409.
- Storage failure after auth delete → 204, then orphan sweep removes the photo.
- User isolation: user A's call never touches user B (rows and `receipts/{B}/`).
- Token of a deleted user: `/me` → 401 "no longer exists"; writes fail with 401, not 500.
- Mobile: warning screen content, password + `DELETE` gating, wrong password, network retry
  message ("not deleted"), success → Welcome with "Your account was deleted", no double submit.
- Manual: one run against a **dedicated throwaway Supabase test account**, only with separate
  explicit approval.

## 5. Decisions needed

1. Backup/log retention period to state in the Privacy Notice (e.g. backups ≤ 7/30 days).
2. Retention rule for the manual dumps in `~/Desktop/Lunti-db-backups`.
3. Approve the `account_deletions` log table (migration) — or accept no deletion evidence.
4. Approve putting the service-role key in the backend env and the `ACCOUNT_DELETION_ENABLED`
   switch.
5. Re-authentication window (proposed 5 minutes) and confirm phrase (`DELETE`).
