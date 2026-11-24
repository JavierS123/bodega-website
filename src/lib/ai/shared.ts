/**
 * AI Cashier contracts shared by the parser (server) and the console (client).
 *
 * Two layers:
 *   1. `LlmOutput`   — what Gemini returns (Structured Output). Entity REFERENCES only
 *                      (SKUs, names, quantities). Never trusted for prices or stock.
 *   2. `CashierDraft` — what the resolver builds from LlmOutput + live Postgres data:
 *                      matched ids, today's prices, stock warnings, totals. This is what
 *                      the Confirmation Card edits and what confirm re-validates.
 */
import { z } from "zod";

import type { ChatStatus } from "@/db/schema";

export const AI_INTENTS = [
  "SALE",
  "DEBT_PAYMENT",
  "RESTOCK",
  "SETTLEMENT",
  "DEBT_QUERY",
  "STOCK_QUERY",
  "UNKNOWN",
] as const;
export type AiIntent = (typeof AI_INTENTS)[number];

/** Intents that produce a Confirmation Card (they write to the ledger once confirmed). */
export const ACTION_INTENTS = ["SALE", "DEBT_PAYMENT", "RESTOCK", "SETTLEMENT"] as const;

/**
 * Owner money movements the AI can log (SETTLEMENT intent):
 * - CASH_DEPOSIT       "cambio efectivo": register cash deposited to the bank.
 * - PAYOUT_TRANSFER    "transferencia": shared account → the owner's personal account.
 * - CAPITAL_INJECTION  "aporte": the owner puts in new money.
 * - PROFIT_WITHDRAWAL  "retiro": profit taken out of the owner's personal account.
 */
export const AI_SETTLEMENT_TYPES = ["CASH_DEPOSIT", "PAYOUT_TRANSFER", "CAPITAL_INJECTION", "PROFIT_WITHDRAWAL"] as const;
export type AiSettlementType = (typeof AI_SETTLEMENT_TYPES)[number];
export type ActionIntent = (typeof ACTION_INTENTS)[number];
export const isActionIntent = (i: AiIntent): i is ActionIntent => (ACTION_INTENTS as readonly string[]).includes(i);

export const MAX_MESSAGE_LENGTH = 500;

/* ── 1. Gemini Structured Output ──────────────────────────────────────────── */

export const LlmOutput = z.object({
  intent: z.enum(AI_INTENTS),
  language: z.enum(["es", "en"]).describe("Language the user wrote in."),
  payment_method: z
    .enum(["CASH", "PAGO_MOVIL", "FIADO"])
    .nullable()
    .describe("SALE: CASH / PAGO_MOVIL / FIADO. DEBT_PAYMENT: CASH or PAGO_MOVIL. Otherwise null."),
  client_name: z.string().nullable().describe("Client as written (Fiado, abono, debt question). Null if none."),
  owner_name: z.string().nullable().describe("Co-owner mentioned (e.g. 'a Frank', 'Frank compra'). Null if none."),
  items: z
    .array(
      z.object({
        sku: z.string().nullable().describe("Best matching SKU from the catalog, or null if no product matches."),
        product_text: z.string().describe("The product exactly as the user wrote it."),
        quantity: z
          .number()
          .int()
          .describe("Units (SALE, DEBT_PAYMENT), number of packs/bultos (RESTOCK), 0 for STOCK_QUERY."),
      }),
    )
    .describe("Products mentioned, in order."),
  pack_cost: z.number().nullable().describe("RESTOCK only: cost of ONE pack/bulto in Bs. Otherwise null."),
  settlement_type: z
    .enum(AI_SETTLEMENT_TYPES)
    .nullable()
    .describe("SETTLEMENT only: which owner money movement. Otherwise null."),
  amount: z
    .number()
    .nullable()
    .describe("DEBT_PAYMENT by money (no products), or SETTLEMENT: the amount in Bs. Otherwise null."),
  confidence_notes: z.string().describe("Short note on anything ambiguous or assumed. Empty string if none."),
  reply: z.string().describe("One short friendly sentence for the user, in their language."),
});
export type LlmOutput = z.infer<typeof LlmOutput>;

/* ── 2. Resolved draft (card) ─────────────────────────────────────────────── */

const money = z.string().regex(/^-?\d{1,10}(\.\d{1,2})?$/);

export const DraftItem = z.object({
  product_id: z.number().int().positive().nullable(),
  sku: z.string().nullable(),
  name: z.string().nullable(),
  /** What the user typed ("platanitos") — shown when the product couldn't be matched. */
  query: z.string(),
  quantity: z.number().int().min(0).max(10_000),
  /** Today's sale price (SALE / DEBT_PAYMENT) — always from Postgres. */
  unit_price: money.nullable(),
  current_stock: z.number().int().nullable(),
  owner_id: z.number().int().nullable(),
  owner_name: z.string().nullable(),
  /** SALE: quantity exceeds current stock. */
  stock_warning: z.boolean(),
});
export type DraftItem = z.infer<typeof DraftItem>;

export const CashierDraft = z.object({
  intent: z.enum(AI_INTENTS),
  language: z.enum(["es", "en"]),
  payment_method: z.enum(["CASH", "PAGO_MOVIL", "FIADO"]).nullable(),
  client_name: z.string().max(80).nullable(),
  client_id: z.number().int().positive().nullable(),
  /** Client name given but not found — confirming creates the client. */
  is_new_client: z.boolean(),
  owner_name: z.string().nullable(),
  owner_id: z.number().int().positive().nullable(),
  items: z.array(DraftItem).max(50),
  /** SETTLEMENT: kind of owner money movement (optional: drafts stored before it existed lack it). */
  settlement_type: z.enum(AI_SETTLEMENT_TYPES).nullable().optional(),
  /** SETTLEMENT: CASH or PAGO_MOVIL (CAPITAL_INJECTION may be either; the rest are fixed). */
  settlement_method: z.enum(["CASH", "PAGO_MOVIL"]).nullable().optional(),
  /** RESTOCK: cost per pack. */
  pack_cost: money.nullable(),
  /** DEBT_PAYMENT by amount (no items). */
  amount: money.nullable(),
  total_amount: money,
  confidence_notes: z.string(),
  reply: z.string(),
});
export type CashierDraft = z.infer<typeof CashierDraft>;

/**
 * Feedback on a cancelled card:
 * - USER_ERROR: the AI understood correctly; the human cancelled for their own reasons.
 * - AI_WRONG:   the AI misread the message → creates a PROPOSED lesson for review.
 */
export const FEEDBACK_VERDICTS = ["USER_ERROR", "AI_WRONG"] as const;
export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];
export const FEEDBACK_COMMENT_MAX = 400;

export interface ChatFeedback {
  verdict: FeedbackVerdict;
  comment: string | null;
  at: string;
  by: string | null;
}

/** Stored in ai_chat_messages.parsed_payload: the AI draft and, once confirmed, what was actually saved. */
export interface ChatPayload {
  v: 1;
  draft: CashierDraft;
  final?: CashierDraft;
  /** Confirmed: did the human change the AI's interpretation before saving? (Implicit feedback.) */
  edited?: boolean;
  /** SETTLEMENT: the owner_settlements row written on confirm (settlements are not ledger transactions). */
  settlementId?: number;
  /** Explicit feedback given on a cancelled card. */
  feedback?: ChatFeedback;
  /** Set when the card was also sent to Telegram — lets web confirms update that message. */
  telegram?: { chatId: number; messageId: number };
}

/** Live-feed refresh: new messages + current state of cards the browser still shows as pending. */
export interface ChatPoll {
  messages: ChatMessageView[];
  updates: Pick<ChatMessageView, "id" | "status" | "linkedTransactionId" | "payload">[];
}

/* ── Chat feed ────────────────────────────────────────────────────────────── */

export interface ChatMessageView {
  /** Postgres id, or a negative/local id for sandbox (visitor) messages. */
  id: number;
  role: "USER" | "ASSISTANT";
  source: "WEB" | "TELEGRAM";
  senderName: string | null;
  content: string;
  status: ChatStatus;
  payload: ChatPayload | null;
  linkedTransactionId: number | null;
  createdAt: Date;
  /** Visitor sandbox message — lives in React state only, never in Postgres. */
  sandbox?: boolean;
  /** Local-only reply (e.g. /help) — not persisted, no sandbox badge. */
  ephemeral?: boolean;
}

export interface ChatPage {
  messages: ChatMessageView[];
  hasMore: boolean;
}

/** Response of POST /api/ai/parse. */
export type ParseResponse =
  | { ok: true; persisted: boolean; user: ChatMessageView; assistant: ChatMessageView }
  | { ok: false; error: "rateLimited"; retryAfterSec: number }
  | { ok: false; error: "invalid" | "notConfigured" | "unknown" };

/** Clickable example prompts (visitors always see them; admins on an empty chat). */
export const EXAMPLE_PROMPTS = {
  es: [
    "Fiado para Katiuska: 2 pepitos y 1 refresco uva",
    "Vendí 3 refrescos negros pago móvil",
    "Jonathan abonó 3 refresco negro por pago móvil a Frank",
    "Frank compra 2 bultos de refresco negro a 6200 cada uno",
    "¿Cuánto debe Jonathan?",
    "¿Cuánto queda de pepito?",
  ],
  en: [
    "Sale: 3 barriletes cash",
    "Fiado for Katiuska: 2 pepitos and 1 grape soda",
    "Jonathan paid 2 refresco negro to Frank by pago móvil",
    "Frank bought 2 packs of refresco negro at 6200 each",
    "How much does Jonathan owe?",
    "How many platanitos are left?",
  ],
} as const;
