# CLAUDE.md — Bodega (Full-Stack Inventory, AI Cashier & BI Platform)

## 1. Project Overview
BodegaOS is a full-stack internal operations and business intelligence web app for a real multi-owner neighborhood shop ("Bodega"), migrating 1,000+ historical transactions from Google Sheets into PostgreSQL. It serves two simultaneous goals:
1. Daily operational replacement for a Telegram-bot + Google Sheets workflow (inventory, bulk-to-unit pricing, 4 co-owners, customer credit/"Fiado", and AI natural-language transaction logging).
2. A live, publicly accessible CV portfolio showcase in read-only demo mode (no login wall for visitors; strict Admin-only mutations).

## 2. Tech Stack & Hosting (100% Free Tier)
- **Framework:** Next.js (App Router) + TypeScript (strict mode)
- **Styling & UI:** Tailwind CSS + Shadcn UI + Lucide Icons
- **Data Tables & Charts:** TanStack Table v8 + Recharts (via Shadcn Charts)
- **Database & Auth:** Supabase (PostgreSQL + Supabase Auth via `@supabase/ssr`)
- **ORM & Validation:** Drizzle ORM (`postgres` driver connected to Supabase Transaction Pooler) + Zod
- **AI Engine:** Google Gen AI SDK (`@google/genai`) using Gemini 2.5 Flash with Structured Outputs (JSON Schema)
- **Hosting:** Vercel Hobby Plan (Free)

## 3. Non-Negotiable Architecture & Security Rules
1. **Public Read-Only Showcase + Admin-Only Writes:**
   - Unauthenticated visitors MUST be able to view all pages (`/`, `/inventory`, `/transactions`, `/clients`, `/owners`, `/analytics`) without a login wall.
   - Display a subtle top banner in visitor mode: "Portfolio Demo Mode (Read-Only) — Live data, writes disabled."
   - There is NO public sign-up page. Only seeded Admin accounts in Supabase Auth can log in at `/login`.
   - EVERY Server Action and mutating API route MUST verify the authenticated Supabase session AND check `user.app_metadata.role === 'admin'` (or an `admin_users` allowlist table) on the server. Never rely on UI hiding alone.
   - Public visitors CAN test the AI Cashier chat bar: Gemini parses their message and renders the live Confirmation Card, but clicking "Confirm" triggers a simulated client-side toast without writing to Postgres. Rate-limit unauthenticated AI requests (e.g., 5 requests/hour per IP).
2. **Database Integrity & Financial Precision:**
   - Store ALL monetary values as PostgreSQL `numeric(12, 2)` — never `float` or `real`.
   - ALWAYS store `unit_price_snapshot` and `unit_cost_snapshot` on `transaction_items` so future price updates never alter historical revenue or profit analytics.
   - ALL multi-step mutations (committing a sale, recording a restock, registering a debt payment, voiding a transaction) MUST execute inside a single PostgreSQL transaction (`db.transaction(...)`).
   - Prefer **voiding (`is_voided = true`) + reversing stock/debt deltas** over hard-deleting historical transactions to preserve auditability.
3. **Currency & Internationalization (EN / ES):**
   - Underlying amounts are in Venezuelan Bolivares (`Bs.`). Note: legacy CSV exports contain `$` symbols (e.g., `$1,200.00`), which actually represent `1,200.00 Bs.` and MUST be stripped and stored as plain numeric values during import.
   - Format all displayed money via a single shared `formatCurrency(value)` utility rendering `Bs. 1,200.00`.
   - Support an instant **EN / ES language toggle** stored in a cookie/context with a clean typed dictionary (`src/lib/i18n/en.ts`, `src/lib/i18n/es.ts`). Do not use complex locale-prefixed URL routing unless necessary; keep routes clean (`/inventory`, `/analytics`, etc.).

## 4. Relational Database Schema (PostgreSQL / Drizzle)
- `owners`: `id`, `name` (unique: Javi, Frank, Anthony, Mamá), `created_at`
- `products`: `id`, `sku` (unique, e.g. `REF_NEG`), `name`, `category`, `owner_id` (FK), `units_per_pack` (int), `pack_cost` (numeric), `unit_cost` (numeric), `margin_pct` (numeric, default 30.00), `sale_price` (numeric), `current_stock` (int), `low_stock_threshold` (int, default 5), `is_active` (bool), `updated_at`
- `clients`: `id`, `name` (unique), `phone`, `notes`, `created_at`
- `transactions`: `id`, `legacy_id` (int, nullable), `occurred_at` (timestamptz), `type` (enum: `SALE`, `DEBT_PAYMENT`, `RESTOCK`, `STOCK_ADJUSTMENT`), `payment_method` (enum: `CASH`, `PAGO_MOVIL`, `FIADO`, `NONE`), `client_id` (nullable FK), `total_amount` (numeric), `notes`, `source` (enum: `WEB_AI`, `WEB_MANUAL`, `TELEGRAM`, `CSV_IMPORT`), `is_voided` (bool, default false), `created_at`
- `transaction_items`: `id`, `transaction_id` (FK), `product_id` (FK), `owner_id` (FK snapshot), `quantity_delta` (int; negative for sales, positive for restocks/positive adjustments), `unit_price_snapshot` (numeric), `unit_cost_snapshot` (numeric), `line_total` (numeric)
- `debt_payments`: `id`, `transaction_id` (FK), `client_id` (FK), `owner_id` (FK), `amount` (numeric), `payment_method` (`CASH` | `PAGO_MOVIL`), `occurred_at` (timestamptz), `notes`
- `owner_settlements`: `id`, `owner_id` (FK), `type` (`PAYOUT_TRANSFER` | `CAPITAL_INJECTION`), `amount` (numeric), `payment_method`, `occurred_at`, `notes`
- `ai_chat_messages`: `id`, `role` (`USER` | `ASSISTANT`), `source` (`WEB` | `TELEGRAM`), `sender_name`, `content` (text), `parsed_payload` (jsonb, nullable), `status` (`PENDING_CONFIRMATION` | `CONFIRMED` | `CANCELLED` | `INFO` | `ERROR`), `linked_transaction_id` (nullable FK), `created_at`

## 5. Folder Structure Conventions
- `src/app/` — App Router pages and API routes (`/api/ai/parse`, `/api/webhooks/telegram`)
- `src/db/` — Drizzle `schema.ts`, `index.ts`, migrations
- `src/lib/auth/` — Supabase SSR server/client helpers + `requireAdmin()` guard
- `src/lib/analytics/` — Modular SQL query functions (easy to add new KPIs/charts)
- `src/lib/ai/` — Gemini client, Zod schemas, system prompt, product/client context builder
- `src/lib/i18n/` — Typed EN/ES dictionary and helper hook
- `src/actions/` — Server Actions grouped by domain (`inventory.ts`, `transactions.ts`, `clients.ts`, `owners.ts`, `chat.ts`)
- `scripts/` — Standalone TypeScript scripts (`import-sheets.ts`, `seed-admin.ts`)

## 6. Code Quality & Workflow
- Always run `npm run typecheck` and `npm run lint` before finishing a phase.
- At the end of every phase, append its results (what was built, decisions, gotchas, open items) to `docs/PHASES.md`. Read that file first when starting a new phase.
- Keep Server Components as default for data fetching; use `'use client'` only for interactive tables, modals, charts, and chat input.
- Every UI table must handle loading skeletons, empty states, and mobile responsiveness gracefully.
- Always use Shadcn semantic color tokens (bg-primary, text-muted-foreground, bg-card, var(--chart-1)) instead of hardcoded Tailwind colors like bg-blue-600 or text-gray-700.