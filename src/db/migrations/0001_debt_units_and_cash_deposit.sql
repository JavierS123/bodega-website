ALTER TYPE "public"."owner_settlement_type" ADD VALUE 'CASH_DEPOSIT';--> statement-breakpoint
ALTER TYPE "public"."owner_settlement_type" ADD VALUE 'PROFIT_WITHDRAWAL';--> statement-breakpoint
CREATE TABLE "debt_payment_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "debt_payment_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"debt_payment_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_snapshot" numeric(12, 2) NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	CONSTRAINT "debt_payment_items_quantity_positive" CHECK ("debt_payment_items"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "debt_payment_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "debt_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "owner_settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "owners" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transaction_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "debt_payment_items" ADD CONSTRAINT "debt_payment_items_debt_payment_id_debt_payments_id_fk" FOREIGN KEY ("debt_payment_id") REFERENCES "public"."debt_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_payment_items" ADD CONSTRAINT "debt_payment_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "debt_payment_items_debt_payment_id_idx" ON "debt_payment_items" USING btree ("debt_payment_id");--> statement-breakpoint
CREATE INDEX "debt_payment_items_product_id_idx" ON "debt_payment_items" USING btree ("product_id");--> statement-breakpoint
CREATE VIEW "public"."client_debt_balances" WITH (security_invoker = true) AS (
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
  );