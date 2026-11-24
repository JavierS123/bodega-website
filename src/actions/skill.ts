"use server";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { aiChatMessages, aiLessons, aiSkillDocs } from "@/db/schema";
import { summarizeDraft } from "@/lib/ai/draft";
import { AiNotConfiguredError, suggestLessonWithGemini } from "@/lib/ai/gemini";
import type { ChatPayload } from "@/lib/ai/shared";
import { LESSON_MAX, SKILL_DOC_MAX, SKILL_SLUGS } from "@/lib/ai/skill-shared";
import type { ActionResult as BaseResult } from "@/lib/action-result";
import { getCurrentUser } from "@/lib/auth/guards";
import { ActionError, runAdminAction, zId } from "@/lib/server/action";

export type SkillErrorCode =
  | "unauthorized"
  | "validation"
  | "notFound"
  | "alreadyHandled"
  | "notConfigured"
  | "unknown";

export type ActionResult<T = undefined> = BaseResult<T, SkillErrorCode>;

function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (data: z.output<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  return runAdminAction<S, T, SkillErrorCode>({ schema, input, label: "skill" }, fn);
}

const who = async () => (await getCurrentUser())?.email ?? null;

/* ── Skill documents ───────────────────────────────────────────────────── */

const docSchema = z.object({
  slug: z.enum(SKILL_SLUGS),
  content: z.string().trim().min(1).max(SKILL_DOC_MAX),
});

/** Save a skill document (rules / help). Takes effect on the next message — no redeploy. */
export async function saveSkillDoc(input: z.input<typeof docSchema>): Promise<ActionResult> {
  return run(docSchema, input, async ({ slug, content }) => {
    const updatedBy = await who();
    await db
      .insert(aiSkillDocs)
      .values({ slug, content, updatedBy })
      .onConflictDoUpdate({ target: aiSkillDocs.slug, set: { content, updatedBy, updatedAt: sql`now()` } });
    return undefined;
  });
}

/** Back to the built-in default (deletes the override row). */
export async function resetSkillDoc(input: { slug: string }): Promise<ActionResult> {
  return run(z.object({ slug: z.enum(SKILL_SLUGS) }), input, async ({ slug }) => {
    await db.delete(aiSkillDocs).where(eq(aiSkillDocs.slug, slug));
    return undefined;
  });
}

/* ── Lessons ───────────────────────────────────────────────────────────── */

const lessonText = z.string().trim().min(3).max(LESSON_MAX);

const reviewSchema = z.discriminatedUnion("action", [
  /** PROPOSED → ACTIVE, optionally with the admin's rewritten text. */
  z.object({ action: z.literal("approve"), id: zId, content: lessonText }),
  /** PROPOSED → deleted (noise, e.g. the owner just changed their mind). */
  z.object({ action: z.literal("discard"), id: zId }),
  /** ACTIVE → ARCHIVED (stops reaching the prompt, kept for history). */
  z.object({ action: z.literal("archive"), id: zId }),
  /** ARCHIVED → ACTIVE. */
  z.object({ action: z.literal("restore"), id: zId }),
  /** Edit the text of any lesson in place. */
  z.object({ action: z.literal("edit"), id: zId, content: lessonText }),
]);

export async function reviewLesson(input: z.input<typeof reviewSchema>): Promise<ActionResult> {
  return run(reviewSchema, input, async (v) => {
    const reviewedBy = await who();
    const reviewed = { reviewedAt: sql`now()`, reviewedBy };
    const where = (status?: "PROPOSED" | "ACTIVE" | "ARCHIVED") =>
      status ? and(eq(aiLessons.id, v.id), eq(aiLessons.status, status)) : eq(aiLessons.id, v.id);

    let rows: { id: number }[];
    switch (v.action) {
      case "approve":
        rows = await db
          .update(aiLessons)
          .set({ status: "ACTIVE", content: v.content, ...reviewed })
          .where(where("PROPOSED"))
          .returning({ id: aiLessons.id });
        break;
      case "discard":
        rows = await db.delete(aiLessons).where(where("PROPOSED")).returning({ id: aiLessons.id });
        break;
      case "archive":
        rows = await db.update(aiLessons).set({ status: "ARCHIVED", ...reviewed }).where(where("ACTIVE")).returning({ id: aiLessons.id });
        break;
      case "restore":
        rows = await db.update(aiLessons).set({ status: "ACTIVE", ...reviewed }).where(where("ARCHIVED")).returning({ id: aiLessons.id });
        break;
      case "edit":
        rows = await db.update(aiLessons).set({ content: v.content, ...reviewed }).where(where()).returning({ id: aiLessons.id });
        break;
    }
    if (rows.length === 0) throw new ActionError("alreadyHandled");
    return undefined;
  });
}

const createSchema = z.object({
  content: lessonText,
  exampleInput: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => v || null),
});

/** A lesson written directly by an admin — active immediately (it was reviewed by its author). */
export async function createLesson(input: z.input<typeof createSchema>): Promise<ActionResult> {
  return run(createSchema, input, async ({ content, exampleInput }) => {
    const reviewedBy = await who();
    await db.insert(aiLessons).values({
      status: "ACTIVE",
      origin: "MANUAL",
      content,
      exampleInput,
      reviewedAt: sql`now()`,
      reviewedBy,
    });
    return undefined;
  });
}

/**
 * Ask Gemini to turn a proposal's evidence into a general rule. Returns the
 * text only — nothing is saved until the admin approves it.
 */
export async function suggestLesson(input: { id: number }): Promise<ActionResult<{ text: string }>> {
  return run(z.object({ id: zId }), input, async ({ id }) => {
    const [row] = await db
      .select({ lesson: aiLessons, payload: aiChatMessages.parsedPayload })
      .from(aiLessons)
      .leftJoin(aiChatMessages, eq(aiChatMessages.id, aiLessons.sourceMessageId))
      .where(eq(aiLessons.id, id));
    if (!row) throw new ActionError("notFound");
    const p = row.payload as ChatPayload | null;
    const context = [
      `Mensaje original: «${row.lesson.exampleInput ?? "(desconocido)"}»`,
      p?.draft ? `Lo que entendió el parser: ${summarizeDraft(p.draft)}` : null,
      p?.final ? `Lo que el dueño corrigió y guardó: ${summarizeDraft(p.final)}` : null,
      p?.feedback?.verdict === "AI_WRONG" ? "El dueño canceló la tarjeta indicando que la IA se equivocó." : null,
      p?.feedback?.comment ? `Comentario del dueño: «${p.feedback.comment}»` : null,
      `Borrador actual de la lección: «${row.lesson.content}»`,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      return { text: await suggestLessonWithGemini(context) };
    } catch (error) {
      if (error instanceof AiNotConfiguredError) throw new ActionError("notConfigured");
      throw error;
    }
  });
}
