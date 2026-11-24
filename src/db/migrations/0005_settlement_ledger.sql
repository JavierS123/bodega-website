ALTER TABLE "owner_settlements" ADD COLUMN "source" "transaction_source" DEFAULT 'WEB_MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "owner_settlements" ADD COLUMN "legacy_id" integer;--> statement-breakpoint
ALTER TABLE "owner_settlements" ADD COLUMN "is_voided" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "owner_settlements" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "owner_settlements" ADD COLUMN "void_reason" text;--> statement-breakpoint
CREATE INDEX "owner_settlements_occurred_at_idx" ON "owner_settlements" USING btree ("occurred_at");--> statement-breakpoint
-- Backfill: CSV-imported movements ("[CSV_IMPORT] Legacy #N · …").
UPDATE "owner_settlements"
SET "source" = 'CSV_IMPORT', "legacy_id" = substring("notes" from 'Legacy #([0-9]+)')::int
WHERE "notes" LIKE '[CSV_IMPORT]%';--> statement-breakpoint
-- Backfill: movements confirmed from an AI Cashier card (web or Telegram).
UPDATE "owner_settlements" s
SET "source" = CASE m."source" WHEN 'TELEGRAM' THEN 'TELEGRAM'::transaction_source ELSE 'WEB_AI'::transaction_source END
FROM "ai_chat_messages" m
WHERE m."parsed_payload" ->> 'settlementId' = s."id"::text;
