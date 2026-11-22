ALTER TABLE "transactions" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "void_reason" text;--> statement-breakpoint
CREATE INDEX "transactions_source_idx" ON "transactions" USING btree ("source");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_void_consistent" CHECK ("transactions"."is_voided" = ("transactions"."voided_at" IS NOT NULL));