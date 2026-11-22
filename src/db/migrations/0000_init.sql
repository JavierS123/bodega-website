CREATE TYPE "public"."chat_role" AS ENUM('USER', 'ASSISTANT');--> statement-breakpoint
CREATE TYPE "public"."chat_source" AS ENUM('WEB', 'TELEGRAM');--> statement-breakpoint
CREATE TYPE "public"."chat_status" AS ENUM('PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'INFO', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."owner_settlement_type" AS ENUM('PAYOUT_TRANSFER', 'CAPITAL_INJECTION');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'PAGO_MOVIL', 'FIADO', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."settlement_method" AS ENUM('CASH', 'PAGO_MOVIL');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('WEB_AI', 'WEB_MANUAL', 'TELEGRAM', 'CSV_IMPORT');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('SALE', 'DEBT_PAYMENT', 'RESTOCK', 'STOCK_ADJUSTMENT');--> statement-breakpoint
CREATE TABLE "ai_chat_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_chat_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"role" "chat_role" NOT NULL,
	"source" "chat_source" NOT NULL,
	"sender_name" text,
	"content" text NOT NULL,
	"parsed_payload" jsonb,
	"status" "chat_status" DEFAULT 'INFO' NOT NULL,
	"linked_transaction_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "clients_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"phone" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "debt_payments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "debt_payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"transaction_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"owner_id" integer NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payment_method" "settlement_method" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	CONSTRAINT "debt_payments_amount_positive" CHECK ("debt_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "owner_settlements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "owner_settlements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"owner_id" integer NOT NULL,
	"type" "owner_settlement_type" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payment_method" "settlement_method" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	CONSTRAINT "owner_settlements_amount_positive" CHECK ("owner_settlements"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "owners_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owners_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "products_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"owner_id" integer NOT NULL,
	"units_per_pack" integer DEFAULT 1 NOT NULL,
	"pack_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"margin_pct" numeric(5, 2) DEFAULT '30.00' NOT NULL,
	"sale_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"current_stock" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 5 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku"),
	CONSTRAINT "products_units_per_pack_positive" CHECK ("products"."units_per_pack" > 0),
	CONSTRAINT "products_pack_cost_non_negative" CHECK ("products"."pack_cost" >= 0),
	CONSTRAINT "products_unit_cost_non_negative" CHECK ("products"."unit_cost" >= 0),
	CONSTRAINT "products_sale_price_non_negative" CHECK ("products"."sale_price" >= 0),
	CONSTRAINT "products_low_stock_threshold_non_negative" CHECK ("products"."low_stock_threshold" >= 0)
);
--> statement-breakpoint
CREATE TABLE "transaction_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transaction_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"transaction_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"owner_id" integer NOT NULL,
	"quantity_delta" integer NOT NULL,
	"unit_price_snapshot" numeric(12, 2) NOT NULL,
	"unit_cost_snapshot" numeric(12, 2) NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	CONSTRAINT "transaction_items_quantity_non_zero" CHECK ("transaction_items"."quantity_delta" <> 0)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"legacy_id" integer,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" "transaction_type" NOT NULL,
	"payment_method" "payment_method" DEFAULT 'NONE' NOT NULL,
	"client_id" integer,
	"total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"source" "transaction_source" NOT NULL,
	"is_voided" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_fiado_requires_client" CHECK ("transactions"."payment_method" <> 'FIADO' OR "transactions"."client_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_linked_transaction_id_transactions_id_fk" FOREIGN KEY ("linked_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_settlements" ADD CONSTRAINT "owner_settlements_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_chat_messages_created_at_idx" ON "ai_chat_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "debt_payments_client_owner_idx" ON "debt_payments" USING btree ("client_id","owner_id");--> statement-breakpoint
CREATE INDEX "debt_payments_owner_id_idx" ON "debt_payments" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "debt_payments_transaction_id_idx" ON "debt_payments" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "owner_settlements_owner_occurred_at_idx" ON "owner_settlements" USING btree ("owner_id","occurred_at");--> statement-breakpoint
CREATE INDEX "products_owner_id_idx" ON "products" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "transaction_items_transaction_id_idx" ON "transaction_items" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_items_product_owner_idx" ON "transaction_items" USING btree ("product_id","owner_id");--> statement-breakpoint
CREATE INDEX "transaction_items_owner_id_idx" ON "transaction_items" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "transactions_occurred_at_idx" ON "transactions" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "transactions_client_id_idx" ON "transactions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "transactions_type_occurred_at_idx" ON "transactions" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_legacy_id_uq" ON "transactions" USING btree ("legacy_id");