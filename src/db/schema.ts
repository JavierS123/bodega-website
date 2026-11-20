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

export const ownerSettlementTypeEnum = pgEnum("owner_settlement_type", [
  "PAYOUT_TRANSFER",
  "CAPITAL_INJECTION",
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
});

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
);

export const clients = pgTable("clients", {
  id: id(),
  name: text("name").notNull().unique(),
  phone: text("phone"),
  notes: text("notes"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

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
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("transactions_occurred_at_idx").on(t.occurredAt),
    index("transactions_client_id_idx").on(t.clientId),
    index("transactions_type_occurred_at_idx").on(t.type, t.occurredAt),
    // Makes the CSV import idempotent (NULLs stay distinct for non-legacy rows).
    uniqueIndex("transactions_legacy_id_uq").on(t.legacyId),
    // A credit sale must be attributable to a client.
    check(
      "transactions_fiado_requires_client",
      sql`${t.paymentMethod} <> 'FIADO' OR ${t.clientId} IS NOT NULL`,
    ),
  ],
);

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
);

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
);

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
);

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
);

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

export const debtPaymentsRelations = relations(debtPayments, ({ one }) => ({
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
export type OwnerSettlement = typeof ownerSettlements.$inferSelect;
export type NewOwnerSettlement = typeof ownerSettlements.$inferInsert;
export type AiChatMessage = typeof aiChatMessages.$inferSelect;
export type NewAiChatMessage = typeof aiChatMessages.$inferInsert;

export type TransactionType = (typeof transactionTypeEnum.enumValues)[number];
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
export type SettlementMethod = (typeof settlementMethodEnum.enumValues)[number];
export type TransactionSource = (typeof transactionSourceEnum.enumValues)[number];
export type ChatStatus = (typeof chatStatusEnum.enumValues)[number];
