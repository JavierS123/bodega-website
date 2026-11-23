# BodegaOS — Phase Log

A running record of each completed phase: what was built, the decisions behind it,
and anything a future session must know. Newest phase at the bottom.
**Update this file at the end of every phase.**

> No secrets here — this repo is public. Credentials live only in `.env` (gitignored).

---

## Phase 1 — Foundation

**Status:** ✅ Complete (commit `a9a3d8d`)

**Built**
- Next.js 16 (App Router, Cache Components) + TypeScript strict, Tailwind v4, shadcn/ui.
- Drizzle schema — [src/db/schema.ts](../src/db/schema.ts): owners, products, clients,
  transactions, transaction_items, debt_payments, owner_settlements, ai_chat_messages.
  All money `numeric(12,2)`; price/cost snapshots on line items.
- Supabase Auth via `@supabase/ssr`; `requireAdmin()` guard in
  [src/lib/auth/guards.ts](../src/lib/auth/guards.ts) (admin = `app_metadata.role === "admin"`
  or email in `ADMIN_EMAILS`). No public sign-up. Session refresh in `src/proxy.ts`.
- EN/ES dictionaries (`src/lib/i18n/`), cookie `bodega_locale`, default `es`.
- `formatCurrency()` → `Bs. 1,200.00` in [src/lib/format.ts](../src/lib/format.ts).

### Supabase setup (done right after Phase 1)
- `.env`: `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the publishable
  key). `DATABASE_URL` = transaction pooler (6543), `DIRECT_URL` = session pooler (5432).
- Migration `0000_init` applied **via the Supabase MCP**, not `drizzle-kit migrate`.
- RLS enabled on every public table with **no policies** (deny-all for PostgREST). The app
  reads/writes through Drizzle as the table owner, which bypasses RLS.

**Gotchas**
- ⚠️ Migrations are applied through the Supabase MCP, so drizzle's migration journal
  table doesn't know about them. **Don't run `npm run db:migrate`** — generate with
  `npm run db:generate`, then apply the SQL through the MCP.
- Security advisor leftovers (not ours): `public.rls_auto_enable()` is callable by
  anon/authenticated; leaked-password protection is off in Auth settings.

---

## Phase 2 — Google Sheets ETL import

**Status:** ✅ Complete — real history imported into Supabase.

**Built**
- `scripts/import-sheets.ts` (+ `scripts/lib/parse.ts`, `scripts/lib/import-core.ts`).
  Reads `scripts/data/{inventario,transacciones,dashboard}.csv` (gitignored — real client data).
- Flags: `--dry-run` (no DB), `--rehearse` (full write + verify, then ROLLBACK),
  `--reset` (replace a previous import), `--dir <folder>`.
- Idempotent: a second run is a no-op. `--reset` deletes only imported rows
  (`source = 'CSV_IMPORT'`, settlements noted `[CSV_IMPORT]`, orphan clients).
- `scripts/seed-sample.ts`: small fake dataset through the same pipeline.
- Audit report: row counts, breakdown, stock anomaly report, debt and owner-balance
  reconciliation against the sheet's dashboard.

**Result (imported 2026-11-20)**
- 4 owners · 22 products · 18 clients · 770 transactions · 889 line items ·
  143 debt payments · 218 debt-payment items · 193 owner settlements.
- Sum of all amounts = **Bs. 3,632,330.00**, matching the sheet's own total.
- Every client's debt and every owner's cash/bank balance reconciles exactly with the sheet.
- Stock to reconcile in the UI: CHUPETA −10, OREO −8, TRULULU −5, COCO_CRUNCH −4,
  JUSTY_MAN 0, TOM_BOCADILLO 0.

**Domain decisions (confirmed by the owner)**
- **Fiado debt is tracked in UNITS and re-priced at today's sale price** (inflation):
  a late payer pays the current price. New table `debt_payment_items` records which units
  each abono settles; view **`client_debt_balances`** is the single definition of debt:
  `Σ(units owed) × current sale_price − cash-only abono credit`. Read debt from this view.
- **`Cambio efectivo`** = depositing register cash into the bank (joins the Pago Móvil
  flow) → settlement type `CASH_DEPOSIT`, not a payout.

**Legacy operation mapping**

| Sheet `Tipo_Operacion` | Stored as |
|---|---|
| Pago movil / Efectivo / Fiado | `SALE` · `PAGO_MOVIL` / `CASH` / `FIADO` |
| Abono Pago movil / Abono Efectivo | `DEBT_PAYMENT` + `debt_payments` (+ `debt_payment_items` for units) |
| Compra Bulto | `RESTOCK` |
| Transferencia | `owner_settlements` · `PAYOUT_TRANSFER` · Pago Móvil |
| Cambio efectivo | `owner_settlements` · `CASH_DEPOSIT` · cash |
| Aporte | `owner_settlements` · `CAPITAL_INJECTION` · Pago Móvil |
| Retiro | `owner_settlements` · `PROFIT_WITHDRAWAL` (moves no shop balance) |
| --- CICLO --- | skipped (separator rows) |

- ⚠️ `Retiro` and `Aporte` were **inferred** from the sheet's balances (they only reconcile
  this way), not confirmed by the owner. Change `OPERATION_MAP` in `import-core.ts` and
  re-import with `--reset` if wrong.
- Data cleanup: mixed `ID_Transaccion` groups split (first keeps `legacy_id`); `Cantidad 0`
  split payments merged into their line (#63, #729); Fiado with no client (#372) →
  "Desconocido (Legacy)"; client names normalized (trim + Title Case).

**Schema changes** — migration `0001_debt_units_and_cash_deposit`: enum values
`CASH_DEPOSIT`, `PROFIT_WITHDRAWAL`; table `debt_payment_items` (RLS on); view
`client_debt_balances` (`security_invoker = true`). All tables marked `.enableRLS()` in the schema.

---

## Phase 3 — App shell + Inventory

**Status:** ✅ Complete (typecheck, lint and production build pass; pages verified with live data).
Admin write paths not yet exercised end-to-end (needs an admin login).

**Built**
- **Shell** — `src/components/layout/`: fixed sidebar (lg+) / left drawer (mobile) with
  6 sections; header with amber demo banner + "Admin login" (visitors) or email + Admin badge +
  Sign out (admins); EN/ES toggle. `SessionProvider`/`useSession()` (UI only) and
  `<AdminOnly>` (disables a control with an "Admin only" tooltip in demo mode).
- Placeholder pages for `/`, `/transactions`, `/clients`, `/owners`, `/analytics`.
- **`/inventory`** — KPI strip (active SKUs, value at cost, low stock, audit needed);
  owner pills, search (accent-insensitive), stock-status filter; TanStack table (sortable)
  on md+, card list on mobile; skeleton + empty states.
- **Admin modals** (Server Actions in [src/actions/inventory.ts](../src/actions/inventory.ts)):
  - Add/Edit Product — live unit cost / suggested price / actual margin; opening stock logged as
    `STOCK_ADJUSTMENT` ("INITIAL_STOCK"); archive/restore instead of delete.
  - Registrar Bulto — `+packs × units_per_pack` stock, updates pack/unit cost (optional sale
    price), `RESTOCK` transaction attributed to the product's owner.
  - Ajustar Stock — physical count → delta preview; required reason
    (`UNRECORDED_RESTOCK | PHYSICAL_COUNT | DAMAGED | LOSS | OTHER`); `STOCK_ADJUSTMENT`
    with `line_total = 0`, notes `"<REASON>: <details>"`; rejects if stock changed meanwhile.

**Conventions established**
- Data fetching: server functions call `await connection()` and render inside `<Suspense>`
  (live data, never cached). Mutations call `refresh()` from `next/cache`.
- Actions return `{ ok: true, data } | { ok: false, error: code }`; the client maps codes to i18n.
- Money math in integer cents (`src/lib/money.ts`); the server recomputes unit cost with
  SQL `round(pack_cost / units_per_pack, 2)`.
- Shared client-safe domain logic in `src/lib/inventory/shared.ts`; KPI SQL in `src/lib/analytics/`.
- Strings: `interpolate("{n} items", { n })` from `src/lib/i18n/config.ts`.

**Gotchas**
- ⚠️ **`max_pipeline: 1` is required** in the postgres.js client (`src/db/index.ts`). Without it,
  parallel queries (e.g. `Promise.all`) pipelined through Supabase's transaction pooler never
  resolve and the page hangs — reproduced and fixed in this phase.
- Next 16 differs from older versions — read `node_modules/next/dist/docs/` before using new APIs.

---

## Phase 4 — Ledger, Clients & Fiado, Owners

**Status:** ✅ Complete (typecheck, lint and production build pass; all three pages verified
against live data). Admin write paths verified at the data-model level (rolled-back SQL), not yet
clicked through with an admin login.

**Built**
- **`/transactions`** — server-paginated ledger (25/page) driven by URL params
  (`from,to,type,method,owner,client,source,status,page`; parsed leniently in
  `src/lib/transactions/shared.ts`). Owner filter = any line item OR debt-payment split for that
  owner. Expandable rows (TanStack) show line items (qty, unit price/cost snapshot, owner, line total),
  the abono split (units settled + cash credit), notes and void info. Mobile card list. Filters update
  via `router.push` in a transition with `useOptimistic` (controls move instantly, table dims).
  Admin: **Manual sale** (multi-line, CASH / PAGO_MOVIL / FIADO, client required for Fiado, stock
  warning), **Edit** (notes / method / client), **Void** (preview of stock + debt effects, required reason).
- **`/clients`** — KPI strip (total pending, debtors, largest balance, abonos last 30 days) and a table
  ranked by pending debt (settled clients hidden by default). Expanding a row shows debt per owner with the
  outstanding units at today's price, cash credit, and the last 25 Fiado/Abono entries.
  Admin: **Add/Edit client**, **Registrar Abono** (client → owner, showing the exact amount owed → amount
  with "pay all", method, live preview of units settled and remaining balance).
- **`/owners`** — owner tabs + 4 comparison cards (net profit + ROI, invested, revenue, pending Fiado,
  cash / Pago Móvil / Por Transferir). Below them: performance and balance breakdown for the selected owner,
  or for all owners combined, plus the settlement history (client-side pagination).
  Admin: **Record settlement** (all 4 types; method limited by type; soft warning if a payout/deposit
  exceeds the available balance).
- Shared: `runAdminAction()` in `src/lib/server/action.ts` (requireAdmin → Zod → run → `refresh()`;
  inventory actions now use it too), `ActionResult<T, Code>` in `src/lib/action-result.ts`,
  `src/components/shared/` (`EmptyState`, `Pill/PillGroup`, `KpiCard`, skeletons, `FormField`,
  typed `OptionSelect`).

**Domain decisions (confirmed by the owner)**
- **Abono settles units**: the amount pays for whole outstanding Fiado units first (oldest Fiado
  first, at today's sale price) → `debt_payment_items`. Any remainder becomes cash credit. Amounts above
  what the client owes that owner are rejected (`exceedsDebt`). The client row is locked
  `FOR UPDATE` so two concurrent abonos can't both pass the check. Unit math:
  `getOutstandingUnits()` in `src/lib/clients/debt.ts` (same logic as the `client_debt_balances` view).
- **Owner profit is cash-basis**: Net = Revenue − Invested; ROI = Net / Invested.
  Invested = capital injections + restocks; Revenue = cash + Pago Móvil sales + collected abonos.
- Owner balances reuse the Phase 2 reconciled formulas (`src/lib/analytics/owners.ts`):
  Cash = cash sales + cash abonos − CASH_DEPOSIT;
  Por Transferir = PM sales + PM abonos + CASH_DEPOSIT + CAPITAL_INJECTION − PAYOUT_TRANSFER.
- **Void** = `is_voided + voided_at + void_reason`, plus reversing each stock delta in one
  `db.transaction`. Debt needs no write, because the view already excludes voided rows. Edit never changes
  amounts or items (void and re-enter instead). A DEBT_PAYMENT's client can't change, and its method change
  is copied onto `debt_payments`.

**Schema changes** — migration `0002_void_audit` (**applied via Supabase MCP**): `transactions.voided_at`,
`void_reason`, index on `source`, check `is_voided = (voided_at IS NOT NULL)`.

**Verification**
- Page numbers match independent SQL: 770 txns, 91 abonos, 279 Fiado sales, total debt Bs. 85,300.00
  (units 88,300 − cash credit 3,000), 193 settlements, per-owner net profit, owner filter (Frank = 465).
- Write-path model tested in a rolled-back DO block: a 1-unit + Bs. 1 abono lowers the balance by exactly
  the amount; voiding it restores the balance; voiding a Fiado sale restores its stock and removes the debt.

**Gotchas**
- Raw `db.execute<T>()` row types must be `type` aliases, not `interface` (they need an index signature).
- Read `searchParams` only inside `<Suspense>` (Cache Components / Partial Prefetching). The page passes
  the promise down to the content component.
- Avoid `formatRelativeTime` in SSR'd client components: server and client clocks differ and cause
  hydration mismatches. Use absolute dates.
- Voiding a RESTOCK reverses stock but **not** the pack cost / sale price it set.
- Legacy split-payment rows (#63, #729) are stored with one payment method, so DB-derived cash/bank can
  differ from the sheet by those amounts.
- Manual sales may drive stock negative on purpose (the shelf wins); `/inventory` flags it as AUDIT.

---

## Follow-up — Semantic color tokens

**Status:** ✅ Complete. Applies the new CLAUDE.md rule (Shadcn semantic tokens only).

- New tokens in `src/app/globals.css` (light + dark), registered as Tailwind colors:
  `success`, `warning`, `info` (+ `-foreground`), `destructive-foreground`, and a colored
  categorical palette `chart-1…6` (it was grayscale and unused before).
- Conventions:
  - **Status**: soft chip = `bg-<status>/10 text-<status> ring-<status>/25`; plain text = `text-<status>`;
    solid fill = `bg-<status> text-<status>-foreground`.
  - **Transaction types**: soft chips (SALE success, DEBT_PAYMENT info, RESTOCK primary, ADJUSTMENT muted).
  - **Payment methods**: outline chips (CASH success, PAGO_MOVIL info, FIADO warning).
  - **Owners**: `ownerColorClass()` → `bg-chart-N/15 text-foreground ring-chart-N/50`;
    `ownerChartColor()` → `var(--chart-N)` for Recharts, so a badge and its chart series match.
- No hardcoded Tailwind palette colors remain under `src/` (except shadcn's own `components/ui`).
- **Light / dark toggle**: `next-themes` `ThemeProvider` in `src/app/layout.tsx` (`attribute="class"`,
  default `system`, choice persisted in localStorage, pre-paint script = no flash). Header button
  `src/components/layout/theme-toggle.tsx` swaps its sun/moon icon with `dark:` classes so SSR and
  client markup match (no `mounted` state needed). Sonner toasts follow the theme automatically.

---

## Phase 5 — AI Cashier Console (`/`)

**Status:** ✅ Complete (typecheck, lint and production build pass). Live Gemini verified with
`gemini-3.5-flash-lite` on 15 prompts, about 1.3–2 s each. Admin confirm not yet clicked through
(it needs an admin login); its write path is verified with rolled-back commits.

**Built**
- **Parser engine (`src/lib/ai/`)**
  - `gemini.ts`: Gemini (`GEMINI_MODEL`, default `gemini-3.5-flash-lite`) with Structured Output.
    The thinking setting follows the model family: 2.5 uses `thinkingBudget: 0`, 3.x uses
    `thinkingLevel: MINIMAL`.
    `responseJsonSchema` is generated from the Zod `LlmOutput` via `z.toJSONSchema`, and the reply is
    re-validated with Zod. Settings: temperature 0, 15 s timeout. A missing or
    rejected key raises `AiNotConfiguredError` (the API returns 503).
  - `prompt.ts`: intents, Bodega vocabulary and few-shot examples; user text is treated as untrusted data.
  - `context.ts`: live catalog per request (active products with sku / name / **aliases** / price / stock /
    owner, plus client and owner names).
  - `resolve.ts`: **Gemini extracts, Postgres decides.** It matches SKU → name/alias/plural fallback
    (accent-insensitive), then clients and owners. Prices, stock warnings, totals and `is_new_client`
    always come from the DB. `answers.ts` computes the INFO replies (debt per owner from
    `client_debt_balances`, current stock) with EN/ES templates.
  - `pipeline.ts`: catalog → Gemini → resolver → (live answer). `draft.ts`: client-safe card math.
- **`POST /api/ai/parse`**
  - Admins: persists the USER and ASSISTANT rows (`parsed_payload = { v: 1, draft }`, status
    `PENDING_CONFIRMATION` / `INFO` / `ERROR`).
  - Visitors: in-memory per-IP limit of 5/hour (`429` + `Retry-After`), a real parse, **no writes**.
- **Chat actions (`src/actions/chat.ts`)**
  - `confirmChatDraft`: one `db.transaction` that locks the message (it must still be pending), creates
    the client if new, commits the ledger rows, then sets `CONFIRMED` + `linked_transaction_id` and stores
    `parsed_payload.final` (the edited draft, as an audit trail).
  - `cancelChatDraft`, and `loadOlderMessages` (public read).
- **UI (`src/components/cashier/`)**
  - A messenger-style thread: day separators, `WEB` / `TELEGRAM` source badges, "Load older messages"
    that keeps the scroll position, a typing bubble, Enter to send, and example chips.
  - **Editable Confirmation Card**: swap product, quantity, payment method, client (datalist; an unknown
    name on a sale = new client), owner/amount for abonos, packs / pack cost for restocks, live totals and
    stock warnings, Confirm & Save / Cancel. Final states: "Confirmed — TX #id" with a link to that day in
    the ledger (and an "edited" tag if the human changed the draft), or "Cancelled".
  - Visitors: a sandbox notice, messages kept in React state with a "Sandbox" badge, and Confirm shows the
    simulated-commit toast.
- **Shared ledger writes (`src/lib/server/ledger.ts`)**: `commitSale`, `commitDebtPayment`,
  `commitRestock` are now the ONLY write path. The manual sale, Registrar Abono and Registrar Bulto
  actions are thin wrappers over them, and the AI confirm reuses them with `source = 'WEB_AI'`.
  `commitDebtPayment` has two modes:
  - **units**: "abonó 3 refresco negro" pays those units at today's price, one split per owner, and is
    rejected if more than owed;
  - **amount**: `allocateAbono()` in `src/lib/clients/allocation.ts` (client-safe). It is the single rule
    used by the ledger write AND both previews (the Registrar Abono dialog and the AI card).
    - **Strict oldest-first, whole units only:** clear as many whole units of the oldest Fiado product as
      the money covers, and **stop** at the first product it can't fully clear. The leftover becomes cash
      credit, so a newer, cheaper item is never paid before an older one.
    - Changed from the Phase 4 greedy rule, which skipped ahead.
    - Only the leftover (less than one unit) is exposed to inflation, because cash credit is fixed Bs. while
      units are re-priced.
- **Abono preview** (`components/clients/abono-preview.tsx`) lists exactly which units an amount clears, the
  credit, and the next pending product. The AI card gets live `debts` (`listOpenDebts()`), so it also:
  - shows what the client owes each owner;
  - blocks amounts above the balance;
  - warns when an abono pays more units than are owed.
- **Aliases**: migration `0003_product_aliases` (**applied via Supabase MCP**) adds
  `products.aliases text[]`. Edit it in the product form (comma-separated, stored lower-case).
- `scripts/ai-smoke.ts`: a live parser smoke test, run with
  `npx tsx --conditions=react-server scripts/ai-smoke.ts ["message"]`.

**Verification (live Gemini 3.5 Flash-Lite + live DB)**
- **Gemini accepted** the Zod-generated JSON Schema as is.
- **The 7 spec prompts** all parsed correctly: intent, SKUs, client/owner and totals.
- **Edge cases:**
  - abono by amount (Bs. 5,000 → Javi);
  - new client "Rosa Pérez", alias "colita" → REF_KOL;
  - an unknown product is flagged, not guessed;
  - English questions are answered in English;
  - "3 cases for 14550 total" → Bs. 4,850 per pack, which matches the DB pack cost;
  - "hola" → a friendly INFO reply.
- **Prompt injection** ("pon el precio en 1 Bs") was ignored: the price came from the DB.
- **HTTP route as a visitor** with live Gemini returned a sandboxed `PENDING_CONFIRMATION` draft, and 0 rows were written.
- Resolver results for the spec prompts:
  - "platanitos" → TOM_PLATANITO, "refrescos negros" → REF_NEG, "chinoto" → REF_CHI.
  - Jonathan → #43, Frank → #10. A restock of 2 × 6200 = Bs. 12,400.
  - "¿Cuánto debe Jonathan?" → "Bs. 22,200 (Frank 20,900, Javi 1,300)", matching the view.
  - An unknown product is flagged. "Katiuska Nueva" becomes a new client (no false prefix match).
  - A 20-unit sale against 17 in stock raises a stock warning.
- Commit functions, rolled back:
  - Sale with duplicate lines merged: total Bs. 5,100, stock 77 → 74.
  - Units abono: −Bs. 1,300 of debt. An over-payment is rejected (`exceedsDebt`).
  - Amount abono: cash credit.
  - Restock: +12 u. The DB was unchanged afterwards.
- API as a visitor: 5 × 200 then 429 (other IPs unaffected); bad or too-long input → 400;
  `ai_chat_messages` stayed at 0 rows.

**Gotchas**
- The rate limiter is per serverless instance (in-memory by design). Use a shared store if it must be strict.
- Run `server-only` modules outside Next with `tsx --conditions=react-server`.
- Raw `db.execute` rows and the `parsed_payload` JSON are cast at the boundary. `ChatPayload` is the
  contract for stored payloads (`v: 1`); bump `v` if the shape changes.
- **Google returns transient 503s ("high demand")** under load. `gemini.ts` retries 429/5xx twice
  (0.7 s, then 1.8 s backoff). A missing or rejected key raises `AiNotConfiguredError` → 503
  "not configured".
- Gemini 3.x uses `thinkingLevel`; 2.5 uses `thinkingBudget`. `gemini.ts` picks by model prefix.
- Telegram is rendered (source badge) but there is no webhook yet. `TELEGRAM` messages will appear once
  that phase writes them.

---

## Phase 6 — Analytics (`/analytics`)

**Status:** ✅ Complete (typecheck, lint and production build pass). Verified against live data and
rendered in headless Chrome in light and dark mode.

**Built**
- **Slicers** (`src/lib/analytics/filters.ts`, client-safe) are synced to the URL:
  - `range=1d|7d|30d|90d|all|custom` (`from`/`to`), `owner`, `method` (CASH/PAGO_MOVIL/FIADO), `category`;
  - invalid params fall back to defaults;
  - `resolvePeriod()` gives the shop-local day window plus an equal-length **previous** window for deltas
    (none for "all").
  - One slicer row sits above everything. While the next slice loads, the current render stays at reduced
    opacity (`useOptimistic` + transition, no skeleton flash).
- **Queries** (`src/lib/analytics/queries.ts`): one self-contained function per metric. Each states the slicers
  it honors and excludes voided rows. They share a `saleLines()` base (revenue, units, cost, profit per line)
  and an `inWindow()` helper.
  - **Adding a metric:** write `getX(f, period)`, add its type to `types.ts`, render it.
- **KPIs:**
  - revenue (sales incl. Fiado), gross profit (revenue − units × `unit_cost_snapshot`) and margin, units;
  - % change vs the previous period (margin change in percentage points);
  - pending Fiado (current snapshot);
  - owner spotlight: highest investor and top-ROI owner.
- **Visuals** (`src/components/analytics/`, Recharts via the shadcn chart component). Each sits in a
  `ChartCard` with a **Chart ⇄ Table** toggle:
  - revenue vs gross profit over time (daily/weekly);
  - top products (units / revenue / net profit, top 10);
  - owner performance: Invested/Revenue/Profit grouped bars, plus a separate ROI % chart;
  - payment-method donut;
  - weekday × hour heatmap;
  - restock & stockout watchlist (days left = stock ÷ average daily sell-through over the period's length,
    clamped 7–90 days, 30 days for "all").
- **CSV export**: `GET /api/analytics/export?dataset=…&<slicers>` for 7 datasets (sales lines, daily, products,
  owners, payments, velocity, watchlist). Same parser and queries as the page, UTF-8 BOM, formula-injection
  guard, 60/hour per IP.

**Decisions**
- **Two profit notions, both labelled:**
  - **gross profit** (sales − cost of goods) for the sales KPIs and charts;
  - owner metrics stay **cash basis**, the same as /owners (revenue = cash + Pago Móvil sales + abonos;
    invested = injections + restocks).
- **No dual axis.** ROI % is its own chart beside the Bs. grouped bars.
- **Slicers that don't apply are disclosed on the card:** owners ignore payment and category; the payment donut
  ignores the payment filter; the watchlist ignores the payment filter.
- **Palette** (dataviz skill, validator-checked):
  - The colors picked by eye in the semantic-tokens change **failed** colorblind checks (deutan ΔE 4.2) and the
    dark lightness band. `--chart-1…8` is now the validated reference order in both modes.
  - **Owners** take slots 1–4 (`(id − 1) mod 8`), and owner badges site-wide changed color accordingly.
  - **Non-owner series** take slots 5–8: revenue violet, profit green, Pago Móvil violet, cash green, Fiado magenta.
  - **The heatmap** is a single-hue sequential scale (slot 1 mixed toward the card surface).
  - The light-mode contrast WARNs are relieved by the table views and legends.
- Big KPI values use proportional figures (`tabular-nums` removed from the shared `KpiCard` too).

**Verification**
- All filter combinations agree internally: series = products = heatmap = sale lines, for revenue.
- Independent SQL matches:
  - all-time revenue Bs. 1,079,300;
  - Fiado in the last 7 days Bs. 22,900;
  - pending Fiado Bs. 85,300.
- 30-day CSV: 217 lines summing to Bs. 315,900, which equals the period's KPI.
- All 7 exports return 200; an unknown dataset returns 400.
- All 8 queries together run in about 0.4–0.5 s.

**Gotchas**
- `shadcn add chart` silently **downgraded recharts to ^3.8** — restored to ^3.11 (check `package.json` after any
  shadcn add).
- Recharts' legend sorts items by data-key strings (`o10` before `o9`); use `itemSorter={null}` to keep the
  order series are drawn in.
- Bash heredocs break on apostrophes in dictionary text; insert large i18n blocks with a script file.

---

## Phase 7 — Telegram bot + production polish

**Status:** ✅ Complete (typecheck, lint and production build pass). The webhook was verified end to end
against a local production build, using test-only env overrides and real Gemini + DB. Live Telegram
delivery is not yet exercised: that needs the deployed HTTPS URL plus the real secret and allowlist.

**Built — Telegram (`/api/webhooks/telegram`)**
- **Auth:** a constant-time check of `X-Telegram-Bot-Api-Secret-Token` against `TELEGRAM_WEBHOOK_SECRET`
  (401 on mismatch, 503 if unconfigured). The sender must be in `TELEGRAM_ALLOWED_USER_IDS`, checked
  on every message **and** every button tap. Only private chats are served.
  - An unknown user is told their Telegram ID, which eases setup.
- **Same brain:** messages go through the exact `runCashierParse()` used by the web. Both messages are
  stored with `source = 'TELEGRAM'`.
  - USER rows carry `parsed_payload.telegram` (`updateId`, `chatId`, …) for de-duplication, because
    Telegram re-delivers updates.
- **✅ Confirm / ❌ Cancel inline keyboard** (`cf:<id>` / `cx:<id>`):
  - Confirm runs **the same** `commitChatDraft()` as the web inside one `db.transaction`, with ledger
    `source = TELEGRAM`.
  - Incomplete drafts (unmatched product, missing client) answer "fix it in the web AI Cashier".
- **Two-way sync:** the card's Telegram message id is stored as `payload.telegram`.
  - Confirming or cancelling on the **web** rewrites the Telegram message (`syncTelegramCard`).
  - The web console polls every 15 s while visible (`pollChat`), picking up Telegram messages and cards
    resolved elsewhere.
- **Refactor:** `src/lib/server/chat-commit.ts` (`commitChatDraft`, `cancelChatDraftCore`) is now the one
  confirm/cancel implementation. `actions/chat.ts` wraps it with `requireAdmin`; Telegram wraps it with the
  allowlist.
- **Setup script:** `npm run telegram:webhook -- set <https-url> | info | delete`.
  - `set` registers the webhook with `secret_token`, `allowed_updates` and bot commands.
  - It validates the secret format and https, and never prints the token.

**Built — polish**
- **Metadata:** a root title template `%s · BodegaOS` with per-page titles and descriptions, OpenGraph and
  Twitter `summary_large_image`, `metadataBase` (`NEXT_PUBLIC_SITE_URL`, else
  `VERCEL_PROJECT_PRODUCTION_URL`), and theme colors.
- **Icons and share image:** `app/icon.svg`, generated `apple-icon`, and a generated 1200×630
  `opengraph-image`.
  - Removed the stock Next `favicon.ico` and the unused create-next-app `public/*.svg` files.
- **Loading and errors:** `app/loading.tsx` (route-level skeleton), `app/error.tsx` (localized, retry +
  digest), `app/global-error.tsx` (bilingual, own html/body), `app/not-found.tsx` (localized 404).
- **README:** portfolio-grade, with 3 Mermaid diagrams (architecture, confirm sequence, data model), a
  security model, setup steps and screenshot placeholders (`docs/screenshots/*.png`).

**Security audit**
- **Server Actions:** every mutating action goes through `runAdminAction` → `requireAdmin`. The
  unguarded exports are intended:
  - `signIn`/`signOut` (no DB writes; non-admins are signed straight back out);
  - `loadOlderMessages`/`pollChat` (read-only public feed).
- **Routes:**
  - `/api/ai/parse`: visitors write nothing (rate-limited); admins write chat rows only.
  - `/api/analytics/export`: read-only.
  - `/api/webhooks/telegram`: secret + allowlist.
- **Client bundle:** a scan of `.next/static` found 0 names or values of `GEMINI_API_KEY`,
  `DATABASE_URL`, `DIRECT_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` or `ADMIN_EMAILS`, and no
  `process.env` reads in client components.
  - The only `postgres://` hit is a literal inside the postgres.js driver file that Turbopack emits as a
    server-traced asset; no client chunk references it.

**Verification (local production build, throwaway secret/allowlist/fake bot token)**
- **Auth:** no secret header → 401, wrong secret → 401.
- **Ignored with no writes:** a non-allow-listed user, `/help`, a group chat and a garbage body.
- **Parse and de-dupe:** "Vendí 2 pepitos pago móvil" became a `PENDING_CONFIRMATION` card (Bs. 2,400).
  Re-delivering the same `update_id` was a no-op. The debt question was answered from SQL.
- **Buttons:**
  - ✅ from a non-allow-listed user: nothing happened;
  - ❌ cancel → `CANCELLED`;
  - ✅ after cancel → already handled;
  - junk callback data: ignored.
- **✅ commit path (rolled back):** a `source = TELEGRAM` sale with stock 77 → 74, the message
  `CONFIRMED` and linked, and a double confirm rejected. The DB was unchanged afterwards.
- **Poll query:** returns new Telegram rows and the cancelled state.
- **Runtime:** icon, apple-icon and OG image return 200, a 404 page is served, and page titles and
  `og:image`/`twitter:card` meta are present.

**Gotchas**
- A layout's `title.template` applies only to **child** segments, so `/` uses `title: { absolute }`.
- `global-error.tsx` can't use the app shell or dictionaries; it only offers `retry()` (as the Next docs
  example does).
- On Windows, curl/bash test messages lose UTF-8 accents. Real Telegram sends UTF-8.

---

## Open items / next up
- Owner to confirm the `Retiro` / `Aporte` interpretation.
- Click through all admin modals (inventory + Phase 4) with a real admin login.
- Settlements can't be edited or voided yet (no `is_voided` on `owner_settlements`) — add if needed.
- Add `GEMINI_API_KEY` on Vercel too (it is set locally). Click through the AI Cashier as an admin:
  confirm one of each (sale, Fiado with a new client, abono, restock).
- Fill in product aliases in /inventory (e.g. "colita", "pepsi negra") to sharpen matching.
- **Telegram go-live (with the deploy):**
  - Set a real `TELEGRAM_WEBHOOK_SECRET` (e.g. `openssl rand -hex 32`) and your user IDs in
    `TELEGRAM_ALLOWED_USER_IDS`, locally and on Vercel.
  - Then run `npm run telegram:webhook -- set https://<app>.vercel.app`.
- **Test rows from the Phase 7 webhook test:** `ai_chat_messages` ids 1–6 (Telegram) remain in the
  public feed. Their removal was declined during the session, so delete them whenever you like.
- Add real screenshots to `docs/screenshots/` (names listed in the README).
- Committed and pushed through Phase 7 (2026-11-22).
