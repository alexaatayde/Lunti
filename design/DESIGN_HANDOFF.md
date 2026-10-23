# Lunti — Design Handoff

Mobile app (Android first, per SRS 2.4) for receipt-based personal finance + meal planning.
Target stack (SDD): **Expo React Native + TypeScript**, FastAPI backend, Supabase (Postgres + Auth).

This folder is the single source of truth for the UI. Build from it; do not invent new styles.

```
screens/      Plain HTML of every screen. Open in a browser; links click through (start at Landing.html).
screenshots/  @2x PNG of every screen at its design size (390 px wide phone).
source/       Original canvas files (.dc.html) + canvas.json (layout, titles).
assets/       Logo files (mark, wordmark, stacked logo) + sample food photo.
```

**How to read a screen:** the PNG shows how it must look; the HTML in `screens/` gives exact
colors, sizes, spacing and SVG icon paths. Treat the HTML as a visual spec — rebuild it with
React Native components (`View`, `Text`, `Pressable`, `react-native-svg`), never paste the HTML.

---

## 1. Design tokens → `src/theme.ts`

### Colors

| Token | Hex | Use |
|---|---|---|
| `bg` | `#FBFBF8` | App background |
| `surface` | `#FFFFFF` | Cards, sheets, inputs |
| `surfaceTint` | `#F4F7EE` | Highlight cards (budget, summary, hero) |
| `borderTint` | `#E3EBD9` | Border of tint cards |
| `border` | `#F3F4F6` | Card borders, row dividers |
| `borderInput` | `#E5E7EB` | Inputs, secondary buttons, chips |
| `text` | `#111827` | Primary text, numbers |
| `textStrong` | `#374151` | Labels |
| `textBody` | `#4B5563` | Body copy |
| `textMuted` | `#6B7280` | Secondary text, meta |
| `textFaint` | `#9CA3AF` | Times, hints, chevrons |
| `primary` | `#539E2F` | Primary buttons, FAB, active chip |
| `primaryBright` | `#5CA833` | Progress fill |
| `primaryLink` | `#4F962D` | Text links ("View pantry", "Edit") |
| `primaryEyebrow` | `#5A9C39` | Eyebrow labels above titles |
| `primaryDeep` | `#1F4812` | Money figures on tint cards, dark CTA band |
| `primaryChipBg` | `#EDF6E8` | Category chip / icon tile background |
| `primaryChipText` | `#3E7525` / `#4D972B` | Text on chip bg |
| `track` | `#DFE8D4` | Progress track |
| `navActiveBg` | `#E3F2E8` | Active tab pill |
| `navActive` | `#1F7A4D` | Active tab icon + label |
| `navLeaf` | `#A7D7B5` | Leaf fill in active tab icon |
| `navInactive` | `#5F6F66` | Inactive tab icon + label |
| `warnBg` / `warnText` | `#FEF3C7` / `#B45309` (strong `#92400E`) | "Use these next", near-limit, expiring |
| `dangerText` / `dangerBg` / `dangerBorder` | `#B91C1C` / `#FEF2F2` / `#FECACA` | Delete, exceeded |
| `scrim` | `rgba(17,24,39,0.45)` | Behind sheets and dialogs |
| `toastBg` | `#111827` (accent `#86D9A6`) | Toasts |
| `logoText` / `logoLeaf` | `#37443B` / `#70A44F` | Logo (use the PNGs) |

### Typography
Font: **SF Pro on iOS, Inter on Android** (load `Inter` 400–900 via `expo-font`).

| Style | Size / weight / letter-spacing | Example |
|---|---|---|
| `eyebrow` | 11 / 700 / +0.05em, UPPERCASE, `primaryEyebrow` | "YOUR FOOD, IN GOOD SHAPE" |
| `pageTitle` | 31–32 / 800 / −0.025em, line-height 1.2 | "Today, at a glance" |
| `sectionTitle` | 18 / 700 | "Pantry pulse" |
| `cardTitle` | 16 / 700 | "3 items are nearing their best" |
| `body` | 14–15 / 400 | descriptions |
| `meta` | 12 / 400–500, `textMuted` | "Groceries · Scanned · 7 items" |
| `small` | 11 / 500 | nav labels, captions |
| `moneyXL` | 34–40 / 900 / −0.025em | "$512.40", amount input |
| `moneyL` | 19–26 / 800–900 | "$337.60" |

### Shape, spacing, elevation
- Screen side padding **20**; gap between sections **16–20**; card padding **16–20**.
- Radius: page cards **24**, list cards **20**, icon tiles **12–16**, inputs/buttons **16**, chips/pills **999**, bottom sheet top **28**, dialog **28**.
- Card shadow `0 2px 8px rgba(0,0,0,0.02)`; primary button shadow `0 10px 15px -3px rgba(83,158,47,0.3)`.
- Touch targets ≥ **44–48**. Primary button height **52**, secondary **48**.

### Icons
- 24×24 grid, stroke **1.75**, round caps/joins. Copy the SVG paths from `screens/NavBar.html`
  into `react-native-svg` components.
- Tab icons (all leaf-free except Home/Meals/Analytics sprouts): Analytics = bars + sprout,
  Budget = plain wallet, Home = house + sprout, Meals = bowl + leaves, Transactions = receipt with 3 lines (long → short).
- Active tab: icon `navActive`, leaves filled `navLeaf`, 56×32 pill `navActiveBg`, label bold.

---

## 2. Shared components → `src/components/`

| Component | Where it appears | Notes |
|---|---|---|
| `AppHeader` | Home, Meals, Grocery list, Pantry, Receipt scan, Transactions | Logo lockup (mark 29×30 + wordmark 59×22) left, 36 px avatar → Profile right |
| `BottomNav` | All 5 tab roots + Transaction detail | 88 px tall; order **Analytics · Budget · Home · Meals · Transactions** (Home centered) |
| `PageTitle` | Most screens | Eyebrow + title (+ optional action on the right, e.g. "+" on Transactions) |
| `Card` / `TintCard` | Everywhere | White + `border` / `surfaceTint` + `borderTint` |
| `ListRow` | Transactions, Detail, Category picker | 40 px icon tile, title + meta, right value + time |
| `Chip` / `FilterChip` | Filters, categories, status | Active = `primary` bg + white text |
| `Button` | Everywhere | `primary`, `secondary` (white + border), `danger`, `ghost` |
| `TextField`, `AmountInput` | Forms, auth | 50–52 px, radius 16; focused = 1.5 px `primary` border + 4 px soft ring |
| `ProgressBar` | Budgets, cart safety | 8–10 px, `track` + `primaryBright`; warn/danger variants |
| `Badge` | "Near limit", "Exceeded", "Use today", "31 scanned" | |
| `BottomSheet` | Add transaction, Category picker | Grabber 40×5, scrim behind |
| `AlertDialog` | Delete confirmation | Icon, title, summary row, Keep / Delete |
| `Toast` | After save / delete | Dark pill above nav, optional **Undo** |
| `Fab` | Home "Scan receipt" | 52 px pill, camera icon, bottom-right above nav |

---

## 3. Screens

`File` = name in `screens/`, `screenshots/`, `source/`. Height is the full scroll length.

| ID | File | Route | SRS | Size |
|---|---|---|---|---|
| A0 | `Landing` | `Welcome` | — | 390×844 |
| A1 | `SignIn` | `SignIn` | 3.5.1 | 390×844 |
| A2 | `SignUp` | `SignUp` (with RA 10173 consent) | 3.5.1 | 390×920 |
| — | `Home` | Tab `Home` | 3.1.3, 3.1.6, 3.1.10 | 390×1166 |
| — | `Analytics` | Tab `Analytics` | 3.1.4–3.1.5 | 390×1380 |
| — | `Budget` | Tab `Budget` (segment: Budget / Profile) | 3.1.3 | 390×844 |
| — | `BudgetCreate` | `BudgetCreate` | 3.1.3 | 390×844 |
| — | `Profile` | `Profile` | 3.5 | 390×844 |
| — | `Notifications` | `Notifications` | 3.7.5 | 390×844 |
| — | `Meals` | Tab `Meals` (Ideas & savings) | 3.1.8–3.1.9 | 390×1052 |
| — | `Pantry` | `Pantry` | 3.1.8 | 390×1104 |
| — | `ShoppingList` | `GroceryList` | 3.1.7 | 390×1084 |
| — | `ScanCamera` | `ScanCamera` (modal stack) | 3.1.2, 3.7.2 | 390×844 |
| — | `ScanReview` | `ScanReview` | 3.1.2 | 390×1124 |
| — | `ScanFailed` | `ScanFailed` | 3.3.2 | 390×844 |
| T1 | `Transactions` | Tab `Transactions` | 3.1.1 | 390×844 |
| T2 | `TxnAddSheet` | `AddTransactionSheet` (bottom sheet) | 3.1.1–3.1.2 | 390×844 |
| T3 | `TxnForm` | `ExpenseForm` (mode `add`) | 3.1.1 | 390×844 |
| T4 | `TxnCategory` | `CategoryPicker` (bottom sheet) | 3.1.1 | 390×844 |
| T5 | `TxnDetail` | `TransactionDetail` | 3.1.1 | 390×1080 |
| T6 | `TxnEdit` | `ExpenseForm` (mode `edit`) | 3.1.1 | 390×844 |
| T7 | `TxnDelete` | `DeleteTransactionDialog` | 3.1.1 | 390×1080 |
| — | `NavBar` | component | — | 390×88 |
| — | `Main` | icon set reference | — | 1280×920 |

`Transactions` has a toast variant (saved / deleted + Undo); `TxnForm` has `add` / `edit` modes —
the screenshots show the defaults, `TxnEdit` shows edit mode.

---

## 4. Navigation

```
Auth stack
  Welcome (A0) ──Get started──▶ SignUp (A2) ──Create account──▶ Main tabs
           └──I already have an account / Skip──▶ SignIn (A1) ──Sign in──▶ Main tabs

Main tabs: Analytics · Budget · Home · Meals · Transactions
  Home ── Scan receipt (FAB) ──▶ ScanCamera
       ── Use these first / View pantry ──▶ Pantry
       ── avatar ──▶ Profile
  Budget ── New budget ──▶ BudgetCreate ; segment ──▶ Profile
  Meals (Ideas) ── Add to list ──▶ GroceryList ; Pantry ── Find a recipe ──▶ Meals

Scan flow (modal stack)
  ScanCamera ── capture ──▶ ScanReview ── confirm ──▶ (save) ──▶ Transactions + toast "saved"
             └─ OCR fails ──▶ ScanFailed ── Try again ──▶ ScanCamera
                                         └─ Enter manually ──▶ ExpenseForm(add)

Transactions flow
  Transactions ── + ──▶ AddTransactionSheet ── Scan a receipt ──▶ ScanCamera
                                            └─ Enter manually ──▶ ExpenseForm(add)
  ExpenseForm ── Category ──▶ CategoryPicker ──▶ back ; Save ──▶ Transactions + toast "saved"
  Transactions ── row ──▶ TransactionDetail ── Edit ──▶ ExpenseForm(edit) ── Save ──▶ Detail
  Detail / ExpenseForm(edit) ── Delete ──▶ DeleteTransactionDialog ── Delete ──▶ Transactions + toast "deleted · Undo"
```

Modals (no bottom nav): Welcome, SignIn, SignUp, ScanCamera/Review/Failed, ExpenseForm,
sheets, dialog, BudgetCreate, Notifications. Bottom nav: the 5 tab roots, Profile, TransactionDetail.

---

## 5. Behaviour rules (from SRS / SDD — must hold in code)

1. **Nothing is saved without the user confirming.** OCR results and AI suggestions are drafts until "Save" / "Confirm".
2. **Money math is deterministic** (integers in centavos, server-side). AI only advises.
3. **Every create / edit / delete of a transaction recalculates budgets** and analytics.
4. Show OCR confidence (Store / Items / Total %) and flag low-confidence fields for review.
5. After save or delete show a toast; delete offers **Undo**.
6. Sign-up requires both consent checkboxes (Terms + Privacy Notice, and RA 10173 data processing).
7. Accessibility: ≥ 44–48 px targets, labels on icon buttons, status never by color alone (icon + text).

---

## 6. Known gaps and open decisions — ask before guessing

- **Two visual generations.** `Analytics`, `Budget`, `BudgetCreate`, `Profile`, `Notifications`,
  `ScanCamera`, `ScanFailed` and the `NavBar` label font still use the earlier style
  (DM Sans, `#1F7A4D`, `#F6FAF6`). **Keep their content and layout, but render them with the
  tokens above** so the app is consistent.
- **Currency & sample data.** Screens mix `$` and `₱` and May/October dates — they are sample data.
  Use one formatter; the SRS market is the Philippines (₱ / PHP). Replace all sample values with API data.
- **Receipt scan CTA** says "Add 7 items to pantry". Per SRS 3.1.2 confirming a scan must save the
  transaction (and may add items to the pantry). Proposed label: "Save & add to pantry" → Transactions + toast.
- **Not designed yet:** Forgot / reset password, intro pages 2–3 of Welcome, OCR "Processing" state,
  Recipe detail, Insights feed, entry point to Notifications (no bell on the current Home).

---

## 7. Suggested build order

1. `theme.ts` (tokens above) + fonts + logo assets.
2. Shared components (section 2) with a simple Storybook-style test screen.
3. Navigation skeleton (section 4) with placeholder screens.
4. Auth: Welcome → SignUp → SignIn (Supabase Auth).
5. Home, then the Transactions flow T1–T7, then the Scan flow.
6. Budget, Analytics, Meals, Pantry, Grocery list, Profile, Notifications.
7. Replace sample data with FastAPI/Supabase calls; wire budget recalculation and toasts.

## 8. Prompt to start your coding assistant

> Build the Lunti mobile app in Expo React Native + TypeScript. The design lives in `/design`
> (this folder). Read `DESIGN_HANDOFF.md` first. For each screen, `screenshots/<Name>.png` shows how
> it must look and `screens/<Name>.html` gives exact colors, sizes, spacing and SVG icon paths —
> treat the HTML as a visual spec and rebuild it with React Native components and react-native-svg.
> Start with step 1–3 of the build order: create `src/theme.ts` from section 1, the shared components
> from section 2, and the navigation skeleton from section 4. Stop after that and show me, before
> building any screen. Follow the behaviour rules in section 5 and ask me about anything in section 6.
