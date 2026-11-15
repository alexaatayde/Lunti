# Pantry confirmations and backdated receipts — design (PROPOSAL, needs approval)

Status: proposal only. Needs one additive migration (0007). Nothing here is implemented or
applied. The "Confirm quantity" action (mobile, no API change) ships separately.

## Problem (found in the 2026-11-15 fixture OCR test)

`ingredient_inventory` keeps only the current amount and a `confirmed_by_user` flag.

1. **A backdated receipt un-confirms a newer count.** Pantry items confirmed today were reset to
   *Estimated* (and increased) by a receipt dated **Nov 9**. A purchase made before the user
   counted is already part of that count, so it should change nothing.
   (`pantry.add_purchase` always adds and always sets `confirmed_by_user = false`.)
2. **Deleting that receipt can't restore the confirmation.** `pantry.remove_purchase` subtracts
   the quantity from estimates but has no record of the earlier confirmed state, so the
   numbers come back but the *Confirmed* status does not.

## Proposal: confirmed snapshot + purchases after it

Add two nullable columns to `ingredient_inventory`:

| column | meaning |
|---|---|
| `confirmed_quantity NUMERIC(12,3)` | the amount the user last confirmed or set (in `unit`) |
| `confirmed_at TIMESTAMPTZ` | when they did it |

An item's amount is then always derivable:

```
estimate = confirmed_quantity (or 0 if never confirmed)
         + Σ food purchases of this product with occurred_at > confirmed_at (all, if never confirmed)
confirmed_by_user = confirmed_at IS NOT NULL AND no such later purchase exists
```

Rules:
- **Confirm quantity / −/+ / edit:** `confirmed_quantity = amount`, `confirmed_at = now()`,
  `confirmed_by_user = true` (same API as today).
- **Receipt confirmed:** if `occurred_at <= confirmed_at` → no change (already counted). Otherwise
  add it and mark the item *Estimated* (today's behaviour).
- **Receipt transaction deleted:** recompute the item with the formula above (instead of
  subtracting). When the deleted purchase was the only one after `confirmed_at`, the item returns
  to exactly `confirmed_quantity` and *Confirmed*. A purchase before `confirmed_at` changes nothing.
- Units: the existing conversion rules apply to each later purchase. A later purchase that can't
  be compared replaces an estimate, as today, but never a confirmed snapshot.
- Recompute runs in the same database transaction as the receipt confirm or delete (SDD 3.2), for
  that user's affected products only.

Why not only use `updated_at` as the confirmation time: it also changes on best-before edits and on
receipt updates, so it can't tell "the user counted" apart from other writes.

## Migration 0007 (additive; previous API keeps working)

```sql
alter table public.ingredient_inventory
  add column confirmed_quantity numeric(12,3),
  add column confirmed_at timestamptz,
  add constraint ck_ingredient_inventory_confirmed_snapshot
    check ((confirmed_quantity is null) = (confirmed_at is null) and coalesce(confirmed_quantity, 0) >= 0);
-- Backfill: the best information available for rows confirmed today.
update public.ingredient_inventory
   set confirmed_quantity = estimated_quantity, confirmed_at = updated_at
 where confirmed_by_user;
```

RLS, policies and grants are unchanged (same table). Downgrade drops the two columns. The 19d3217
API ignores the new columns, so the order is: apply 0007, then deploy the new API.
Same live procedure as 0006: fresh backup + restore check, rehearsal, guarded apply script.

## Tests to add with the change

- Backdated receipt (occurred before `confirmed_at`): amount and *Confirmed* unchanged.
- Receipt after confirmation: amount added, *Estimated*; deleting it → back to `confirmed_quantity`
  and *Confirmed* (the exact scenario from the fixture test).
- Two later receipts, delete one: still *Estimated*, amount = snapshot + the remaining one.
- Never-confirmed item: behaves exactly as today (adds, subtracts, clamps at 0).
- Unit conversion (g → kg) for later purchases; an incomparable unit never overwrites a snapshot.
- Edit of a receipt transaction's date across `confirmed_at` (moves in or out of the estimate).
- Migration: up/down/up, backfill of confirmed rows, constraint, previous API compatible on 0007.
- RLS: unchanged isolation for `ingredient_inventory`.

## Out of scope

No automatic decrease over time, no new screens. The mobile app needs no change: it already shows
`confirmed` and the amount from the API.
