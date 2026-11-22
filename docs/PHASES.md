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

## Open items / next up
- Owner to confirm the `Retiro` / `Aporte` interpretation.
- Test the three inventory modals with an admin login.
- Not yet committed: Phases 2–3 (as of 2026-11-22).
