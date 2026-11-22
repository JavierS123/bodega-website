import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  pgView,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* ────────────────────────────────────────────────────────────────────────────
 * Shared column helpers
 * Money is ALWAYS numeric(12, 2). Drizzle returns numerics as strings, which
 * preserves exact precision — convert at the edges only (display / math libs).
 * ──────────────────────────────────────────────────────────────────────────── */

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });
const pct = (name: string) => numeric(name, { precision: 5, scale: 2 });
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const id = () => integer("id").primaryKey().generatedAlwaysAsIdentity();

/* ────────────────────────────────────────────────────────────────────────────
 * Enums
 * ──────────────────────────────────────────────────────────────────────────── */

export const transactionTypeEnum = pgEnum("transaction_type", [
  "SALE",
  "DEBT_PAYMENT",
  "RESTOCK",
  "STOCK_ADJUSTMENT",
]);

export const paymentMethodEnum = pgEnum("payment_method", ["CASH", "PAGO_MOVIL", "FIADO", "NONE"]);

/** Methods that actually move money (no FIADO / NONE). */
export const settlementMethodEnum = pgEnum("settlement_method", ["CASH", "PAGO_MOVIL"]);

export const transactionSourceEnum = pgEnum("transaction_source", [
  "WEB_AI",
  "WEB_MANUAL",
  "TELEGRAM",
  "CSV_IMPORT",
]);

/**
 * Owner money movements outside of sales:
 * - PAYOUT_TRANSFER:    shop → owner's account (Pago Móvil). Legacy "Transferencia".
 * - CAPITAL_INJECTION:  owner → shop. Legacy "Aporte".
 * - CASH_DEPOSIT:       the owner's register cash deposited into the bank, so it joins
 *                       the Pago Móvil flow (cash ↓, bank ↑; owner balance unchanged).
 *                       payment_method = CASH (the source). Legacy "Cambio efectivo".
 * - PROFIT_WITHDRAWAL:  owner takes profit out of money already paid out to them.
 *                       Informational: it does NOT move shop cash or bank balances.
 *                       Legacy "Retiro".
 */
export const ownerSettlementTypeEnum = pgEnum("owner_settlement_type", [
  "PAYOUT_TRANSFER",
  "CAPITAL_INJECTION",
  "CASH_DEPOSIT",
  "PROFIT_WITHDRAWAL",
]);

export const chatRoleEnum = pgEnum("chat_role", ["USER", "ASSISTANT"]);
export const chatSourceEnum = pgEnum("chat_source", ["WEB", "TELEGRAM"]);
export const chatStatusEnum = pgEnum("chat_status", [
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "CANCELLED",
  "INFO",
  "ERROR",
]);

/* ────────────────────────────────────────────────────────────────────────────
 * Tables
 * ──────────────────────────────────────────────────────────────────────────── */

export const owners = pgTable("owners", {
  id: id(),
  name: text("name").notNull().unique(), // Javi, Frank, Anthony, Mamá
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}).enableRLS();

export const products = pgTable(
  "products",
  {
    id: id(),
    sku: text("sku").notNull().unique(), // e.g. REF_NEG
    name: text("name").notNull(),
    category: text("category"),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "restrict" }),
    unitsPerPack: integer("units_per_pack").notNull().default(1),
    packCost: money("pack_cost").notNull().default("0"),
    unitCost: money("unit_cost").notNull().default("0"),
    marginPct: pct("margin_pct").notNull().default("30.00"),
    salePrice: money("sale_price").notNull().default("0"),
    currentStock: integer("current_stock").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(5),
    isActive: boolean("is_active").notNull().default(true),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("products_owner_id_idx").on(t.ownerId),
    index("products_category_idx").on(t.category),
    check("products_units_per_pack_positive", sql`${t.unitsPerPack} > 0`),
    check("products_pack_cost_non_negative", sql`${t.packCost} >= 0`),
    check("products_unit_cost_non_negative", sql`${t.unitCost} >= 0`),
    check("products_sale_price_non_negative", sql`${t.salePrice} >= 0`),
    check("products_low_stock_threshold_non_negative", sql`${t.lowStockThreshold} >= 0`),
  ],
).enableRLS();

export const clients = pgTable("clients", {
  id: id(),
  name: text("name").notNull().unique(),
  phone: text("phone"),
  notes: text("notes"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}).enableRLS();

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    legacyId: integer("legacy_id"), // row id from the Google Sheets export
    occurredAt: timestamptz("occurred_at").notNull().defaultNow(),
    type: transactionTypeEnum("type").notNull(),
    paymentMethod: paymentMethodEnum("payment_method").notNull().default("NONE"),
    clientId: integer("client_id").references(() => clients.id, { onDelete: "restrict" }),
    totalAmount: money("total_amount").notNull().default("0"),
    notes: text("notes"),
    source: transactionSourceEnum("source").notNull(),
    isVoided: boolean("is_voided").notNull().default(false),
    /** When / why a transaction was voided (audit trail; the row itself is never deleted). */
    voidedAt: timestamptz("voided_at"),
    voidReason: text("void_reason"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("transactions_occurred_at_idx").on(t.occurredAt),
    index("transactions_source_idx").on(t.source),
    index("transactions_client_id_idx").on(t.clientId),
    index("transactions_type_occurred_at_idx").on(t.type, t.occurredAt),
    // Makes the CSV import idempotent (NULLs stay distinct for non-legacy rows).
    uniqueIndex("transactions_legacy_id_uq").on(t.legacyId),
    // A credit sale must be attributable to a client.
    check(
      "transactions_fiado_requires_client",
      sql`${t.paymentMethod} <> 'FIADO' OR ${t.clientId} IS NOT NULL`,
    ),
    check(
      "transactions_void_consistent",
      sql`${t.isVoided} = (${t.voidedAt} IS NOT NULL)`,
    ),
  ],
).enableRLS();

export const transactionItems = pgTable(
  "transaction_items",
  {
    id: id(),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    /** Owner of the product at the time of the transaction (snapshot). */
    ownerId: integer("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "restrict" }),
    /** Negative for sales, positive for restocks / positive adjustments. */
    quantityDelta: integer("quantity_delta").notNull(),
    unitPriceSnapshot: money("unit_price_snapshot").notNull(),
    unitCostSnapshot: money("unit_cost_snapshot").notNull(),
    lineTotal: money("line_total").notNull(),
  },
  (t) => [
    index("transaction_items_transaction_id_idx").on(t.transactionId),
    index("transaction_items_product_owner_idx").on(t.productId, t.ownerId),
    index("transaction_items_owner_id_idx").on(t.ownerId),
    check("transaction_items_quantity_non_zero", sql`${t.quantityDelta} <> 0`),
  ],
).enableRLS();

export const debtPayments = pgTable(
  "debt_payments",
  {
    id: id(),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "restrict" }),
    amount: money("amount").notNull(),
    paymentMethod: settlementMethodEnum("payment_method").notNull(),
    occurredAt: timestamptz("occurred_at").notNull().defaultNow(),
    notes: text("notes"),
  },
  (t) => [
    index("debt_payments_client_owner_idx").on(t.clientId, t.ownerId),
    index("debt_payments_owner_id_idx").on(t.ownerId),
    index("debt_payments_transaction_id_idx").on(t.transactionId),
    check("debt_payments_amount_positive", sql`${t.amount} > 0`),
  ],
).enableRLS();

/**
 * Units of a Fiado debt that a payment settles. Debt is tracked in UNITS and
 * re-priced at the product's current sale_price (inflation): a client who pays
 * late pays today's price. A debt payment with no items (or whose amount
 * exceeds its items' line_total) is a cash credit on the client's account.
 * See the `client_debt_balances` view.
 */
export const debtPaymentItems = pgTable(
  "debt_payment_items",
  {
    id: id(),
    debtPaymentId: integer("debt_payment_id")
      .notNull()
      .references(() => debtPayments.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    /** Price per unit actually paid on the day (for audit; balances use current price). */
    unitPriceSnapshot: money("unit_price_snapshot").notNull(),
    lineTotal: money("line_total").notNull(),
  },
  (t) => [
    index("debt_payment_items_debt_payment_id_idx").on(t.debtPaymentId),
    index("debt_payment_items_product_id_idx").on(t.productId),
    check("debt_payment_items_quantity_positive", sql`${t.quantity} > 0`),
  ],
).enableRLS();

export const ownerSettlements = pgTable(
  "owner_settlements",
  {
    id: id(),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "restrict" }),
    type: ownerSettlementTypeEnum("type").notNull(),
    amount: money("amount").notNull(),
    paymentMethod: settlementMethodEnum("payment_method").notNull(),
    occurredAt: timestamptz("occurred_at").notNull().defaultNow(),
    notes: text("notes"),
  },
  (t) => [
    index("owner_settlements_owner_occurred_at_idx").on(t.ownerId, t.occurredAt),
    check("owner_settlements_amount_positive", sql`${t.amount} > 0`),
  ],
).enableRLS();

export const aiChatMessages = pgTable(
  "ai_chat_messages",
  {
    id: id(),
    role: chatRoleEnum("role").notNull(),
    source: chatSourceEnum("source").notNull(),
    senderName: text("sender_name"),
    content: text("content").notNull(),
    parsedPayload: jsonb("parsed_payload").$type<Record<string, unknown>>(),
    status: chatStatusEnum("status").notNull().default("INFO"),
    linkedTransactionId: integer("linked_transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [index("ai_chat_messages_created_at_idx").on(t.createdAt)],
).enableRLS();

/* ────────────────────────────────────────────────────────────────────────────
 * Views
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Outstanding Fiado debt per (client, owner), RE-PRICED AT TODAY'S PRICE:
 *
 *   units_value = Σ (units sold on Fiado − units settled by abonos) × products.sale_price
 *   cash_credit = Σ abono money not tied to units (debt_payments.amount − its items)
 *   balance     = units_value − cash_credit
 *
 * Voided transactions are excluded. security_invoker keeps RLS in force for
 * PostgREST callers (the app reads it through Drizzle as the owner).
 */
export const clientDebtBalances = pgView("client_debt_balances", {
  clientId: integer("client_id").notNull(),
  ownerId: integer("owner_id").notNull(),
  unitsValue: money("units_value").notNull(),
  cashCredit: money("cash_credit").notNull(),
  balance: money("balance").notNull(),
})
  .with({ securityInvoker: true })
  .as(sql`
    with unit_moves as (
      select t.client_id, ti.owner_id, ti.product_id, -ti.quantity_delta as units
      from transaction_items ti
      join transactions t on t.id = ti.transaction_id
      where t.type = 'SALE' and t.payment_method = 'FIADO'
        and not t.is_voided and t.client_id is not null
      union all
      select dp.client_id, dp.owner_id, dpi.product_id, -dpi.quantity
      from debt_payment_items dpi
      join debt_payments dp on dp.id = dpi.debt_payment_id
      join transactions t on t.id = dp.transaction_id
      where not t.is_voided
    ),
    units_value as (
      select um.client_id, um.owner_id, sum(um.units * p.sale_price)::numeric(12, 2) as value
      from unit_moves um
      join products p on p.id = um.product_id
      group by um.client_id, um.owner_id
    ),
    cash_credit as (
      select dp.client_id, dp.owner_id,
             sum(dp.amount - coalesce(i.items_total, 0))::numeric(12, 2) as value
      from debt_payments dp
      join transactions t on t.id = dp.transaction_id
      left join (
        select debt_payment_id, sum(line_total) as items_total
        from debt_payment_items group by debt_payment_id
      ) i on i.debt_payment_id = dp.id
      where not t.is_voided
      group by dp.client_id, dp.owner_id
    )
    select coalesce(u.client_id, c.client_id) as client_id,
           coalesce(u.owner_id, c.owner_id) as owner_id,
           coalesce(u.value, 0)::numeric(12, 2) as units_value,
           coalesce(c.value, 0)::numeric(12, 2) as cash_credit,
           (coalesce(u.value, 0) - coalesce(c.value, 0))::numeric(12, 2) as balance
    from units_value u
    full join cash_credit c on c.client_id = u.client_id and c.owner_id = u.owner_id
  `);

/* ────────────────────────────────────────────────────────────────────────────
 * Relations (for Drizzle's relational query API: db.query.*)
 * ──────────────────────────────────────────────────────────────────────────── */

export const ownersRelations = relations(owners, ({ many }) => ({
  products: many(products),
  transactionItems: many(transactionItems),
  debtPayments: many(debtPayments),
  settlements: many(ownerSettlements),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  owner: one(owners, { fields: [products.ownerId], references: [owners.id] }),
  transactionItems: many(transactionItems),
}));

export const clientsRelations = relations(clients, ({ many }) => ({
  transactions: many(transactions),
  debtPayments: many(debtPayments),
}));

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  client: one(clients, { fields: [transactions.clientId], references: [clients.id] }),
  items: many(transactionItems),
  debtPayments: many(debtPayments),
}));

export const transactionItemsRelations = relations(transactionItems, ({ one }) => ({
  transaction: one(transactions, {
    fields: [transactionItems.transactionId],
    references: [transactions.id],
  }),
  product: one(products, { fields: [transactionItems.productId], references: [products.id] }),
  owner: one(owners, { fields: [transactionItems.ownerId], references: [owners.id] }),
}));

export const debtPaymentItemsRelations = relations(debtPaymentItems, ({ one }) => ({
  debtPayment: one(debtPayments, {
    fields: [debtPaymentItems.debtPaymentId],
    references: [debtPayments.id],
  }),
  product: one(products, { fields: [debtPaymentItems.productId], references: [products.id] }),
}));

export const debtPaymentsRelations = relations(debtPayments, ({ one, many }) => ({
  items: many(debtPaymentItems),
  transaction: one(transactions, {
    fields: [debtPayments.transactionId],
    references: [transactions.id],
  }),
  client: one(clients, { fields: [debtPayments.clientId], references: [clients.id] }),
  owner: one(owners, { fields: [debtPayments.ownerId], references: [owners.id] }),
}));

export const ownerSettlementsRelations = relations(ownerSettlements, ({ one }) => ({
  owner: one(owners, { fields: [ownerSettlements.ownerId], references: [owners.id] }),
}));

export const aiChatMessagesRelations = relations(aiChatMessages, ({ one }) => ({
  linkedTransaction: one(transactions, {
    fields: [aiChatMessages.linkedTransactionId],
    references: [transactions.id],
  }),
}));

/* ────────────────────────────────────────────────────────────────────────────
 * Inferred types
 * ──────────────────────────────────────────────────────────────────────────── */

export type Owner = typeof owners.$inferSelect;
export type NewOwner = typeof owners.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type TransactionItem = typeof transactionItems.$inferSelect;
export type NewTransactionItem = typeof transactionItems.$inferInsert;
export type DebtPayment = typeof debtPayments.$inferSelect;
export type NewDebtPayment = typeof debtPayments.$inferInsert;
export type DebtPaymentItem = typeof debtPaymentItems.$inferSelect;
export type NewDebtPaymentItem = typeof debtPaymentItems.$inferInsert;
export type ClientDebtBalance = typeof clientDebtBalances.$inferSelect;
export type OwnerSettlement = typeof ownerSettlements.$inferSelect;
export type NewOwnerSettlement = typeof ownerSettlements.$inferInsert;
export type AiChatMessage = typeof aiChatMessages.$inferSelect;
export type NewAiChatMessage = typeof aiChatMessages.$inferInsert;

export type TransactionType = (typeof transactionTypeEnum.enumValues)[number];
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
export type SettlementMethod = (typeof settlementMethodEnum.enumValues)[number];
export type TransactionSource = (typeof transactionSourceEnum.enumValues)[number];
export type ChatStatus = (typeof chatStatusEnum.enumValues)[number];
export type OwnerSettlementType = (typeof ownerSettlementTypeEnum.enumValues)[number];
