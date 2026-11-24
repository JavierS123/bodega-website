CREATE TYPE "public"."ai_lesson_origin" AS ENUM('EDITED_CONFIRM', 'CANCEL_FEEDBACK', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."ai_lesson_status" AS ENUM('PROPOSED', 'ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "ai_lessons" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_lessons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"status" "ai_lesson_status" DEFAULT 'PROPOSED' NOT NULL,
	"origin" "ai_lesson_origin" NOT NULL,
	"example_input" text,
	"content" text NOT NULL,
	"source_message_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	CONSTRAINT "ai_lessons_content_length" CHECK (char_length("ai_lessons"."content") between 1 and 600)
);
--> statement-breakpoint
ALTER TABLE "ai_lessons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_skill_docs" (
	"slug" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "ai_skill_docs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_lessons" ADD CONSTRAINT "ai_lessons_source_message_id_ai_chat_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."ai_chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_lessons_status_idx" ON "ai_lessons" USING btree ("status","created_at");