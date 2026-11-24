import "server-only";

import { desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { aiChatMessages, aiLessons, aiSkillDocs } from "@/db/schema";

import { summarizeDraft, wasEdited } from "./draft";
import type { ChatPayload } from "./shared";
import {
  MAX_ACTIVE_LESSONS,
  SKILL_DEFAULTS,
  type FeedbackStats,
  type LessonView,
  type SkillDocData,
  type SkillSlug,
} from "./skill-shared";

const toDoc = (slug: SkillSlug, row?: typeof aiSkillDocs.$inferSelect): SkillDocData =>
  row
    ? { slug, content: row.content, isDefault: false, updatedAt: row.updatedAt, updatedBy: row.updatedBy }
    : { slug, content: SKILL_DEFAULTS[slug], isDefault: true, updatedAt: null, updatedBy: null };

/** One skill document (DB row, or the built-in default). */
export async function getSkillDoc(slug: SkillSlug): Promise<SkillDocData> {
  const [row] = await db.select().from(aiSkillDocs).where(eq(aiSkillDocs.slug, slug));
  return toDoc(slug, row);
}

export async function getSkillDocs(slugs: readonly SkillSlug[]): Promise<Record<SkillSlug, SkillDocData>> {
  const rows = await db.select().from(aiSkillDocs).where(inArray(aiSkillDocs.slug, [...slugs]));
  return Object.fromEntries(slugs.map((s) => [s, toDoc(s, rows.find((r) => r.slug === s))])) as Record<
    SkillSlug,
    SkillDocData
  >;
}

/** The /help reply for a language (plain text; Telegram escapes it). */
export async function getHelpText(lang: "es" | "en"): Promise<string> {
  return (await getSkillDoc(lang === "en" ? "help_en" : "help_es")).content;
}

export interface PromptSkill {
  rules: string;
  lessons: { id: number; content: string; exampleInput: string | null }[];
}

/** What the parser injects into the system prompt: the rules doc + approved lessons (newest first). */
export async function loadPromptSkill(): Promise<PromptSkill> {
  const rules = (await getSkillDoc("rules")).content;
  const lessons = await db
    .select({ id: aiLessons.id, content: aiLessons.content, exampleInput: aiLessons.exampleInput })
    .from(aiLessons)
    .where(eq(aiLessons.status, "ACTIVE"))
    .orderBy(sql`${aiLessons.reviewedAt} desc nulls last`, desc(aiLessons.id))
    .limit(MAX_ACTIVE_LESSONS);
  return { rules, lessons };
}

/** Compact prompt block for the approved lessons ("" when there are none). */
export function renderLessons(lessons: PromptSkill["lessons"]): string {
  return lessons
    .map((l) => {
      const example = l.exampleInput ? ` (ejemplo: «${l.exampleInput.replace(/\s+/g, " ").slice(0, 200)}»)` : "";
      return `- ${l.content.replace(/\s+/g, " ").trim()}${example}`;
    })
    .join("\n");
}

/** Every lesson with the context of the chat message it came from (skill page). */
export async function listLessons(): Promise<LessonView[]> {
  const rows = await db
    .select({ lesson: aiLessons, payload: aiChatMessages.parsedPayload })
    .from(aiLessons)
    .leftJoin(aiChatMessages, eq(aiChatMessages.id, aiLessons.sourceMessageId))
    .orderBy(desc(aiLessons.createdAt), desc(aiLessons.id))
    .limit(500);
  return rows.map(({ lesson: l, payload }) => {
    const p = payload as ChatPayload | null;
    return {
      id: l.id,
      status: l.status,
      origin: l.origin,
      exampleInput: l.exampleInput,
      content: l.content,
      sourceMessageId: l.sourceMessageId,
      aiSummary: p?.draft ? summarizeDraft(p.draft) : null,
      finalSummary: p?.final ? summarizeDraft(p.final) : null,
      comment: p?.feedback?.comment ?? null,
      createdAt: l.createdAt,
      reviewedAt: l.reviewedAt,
      reviewedBy: l.reviewedBy,
    };
  });
}

/** How the AI Cashier's readings fared: confirmed as-is, corrected, or cancelled (with feedback). */
export async function getFeedbackStats(): Promise<FeedbackStats> {
  const rows = await db
    .select({ status: aiChatMessages.status, payload: aiChatMessages.parsedPayload })
    .from(aiChatMessages)
    .where(
      sql`${aiChatMessages.role} = 'ASSISTANT' and ${aiChatMessages.status} in ('CONFIRMED', 'CANCELLED')`,
    );
  const s: FeedbackStats = {
    confirmedClean: 0,
    confirmedEdited: 0,
    cancelledUserError: 0,
    cancelledAiWrong: 0,
    cancelledNoFeedback: 0,
    accuracy: null,
  };
  for (const r of rows) {
    const p = r.payload as ChatPayload | null;
    if (!p?.draft) continue;
    if (r.status === "CONFIRMED") {
      // Rows confirmed before `edited` was stored: derive it from draft vs final.
      const edited = p.edited ?? (p.final ? wasEdited(p.draft, p.final) : false);
      if (edited) s.confirmedEdited++;
      else s.confirmedClean++;
    } else if (p.feedback?.verdict === "AI_WRONG") s.cancelledAiWrong++;
    else if (p.feedback?.verdict === "USER_ERROR") s.cancelledUserError++;
    else s.cancelledNoFeedback++;
  }
  const right = s.confirmedClean + s.cancelledUserError;
  const judged = right + s.confirmedEdited + s.cancelledAiWrong;
  s.accuracy = judged > 0 ? right / judged : null;
  return s;
}
