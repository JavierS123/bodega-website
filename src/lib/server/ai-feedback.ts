import "server-only";

import { and, desc, eq, lt } from "drizzle-orm";

import type { Database } from "@/db";
import { aiChatMessages, aiLessons, type AiLessonOrigin } from "@/db/schema";
import { summarizeDraft } from "@/lib/ai/draft";
import type { CashierDraft, ChatFeedback, ChatPayload, FeedbackVerdict } from "@/lib/ai/shared";
import { LESSON_MAX } from "@/lib/ai/skill-shared";

import { ActionError } from "./action";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Pick<Database, "select" | "insert" | "update">;

/** The user message an assistant reply answered: the latest USER row before it on the same channel. */
export async function findUserInput(executor: Pick<Database, "select">, assistantId: number): Promise<string | null> {
  const [reply] = await executor
    .select({ source: aiChatMessages.source })
    .from(aiChatMessages)
    .where(eq(aiChatMessages.id, assistantId));
  if (!reply) return null;
  const [row] = await executor
    .select({ content: aiChatMessages.content })
    .from(aiChatMessages)
    .where(
      and(
        lt(aiChatMessages.id, assistantId),
        eq(aiChatMessages.role, "USER"),
        eq(aiChatMessages.source, reply.source),
      ),
    )
    .orderBy(desc(aiChatMessages.id))
    .limit(1);
  return row?.content ?? null;
}

/** Deterministic first draft of a lesson; the admin rewrites it (or asks Gemini) before approving. */
function draftLessonText(o: { draft: CashierDraft; final?: CashierDraft; comment?: string | null }): string {
  const parts = [`La IA propuso: ${summarizeDraft(o.draft)}.`];
  if (o.final) parts.push(`Se guardó: ${summarizeDraft(o.final)}.`);
  if (o.comment) parts.push(`Comentario: ${o.comment}`);
  return parts.join(" ").slice(0, LESSON_MAX);
}

/** Creates a PROPOSED lesson for review (one per chat message and origin). */
export async function proposeLesson(
  executor: Executor,
  o: {
    messageId: number;
    origin: Exclude<AiLessonOrigin, "MANUAL">;
    draft: CashierDraft;
    final?: CashierDraft;
    comment?: string | null;
  },
): Promise<void> {
  const [existing] = await executor
    .select({ id: aiLessons.id })
    .from(aiLessons)
    .where(and(eq(aiLessons.sourceMessageId, o.messageId), eq(aiLessons.origin, o.origin)))
    .limit(1);
  if (existing) return;
  const exampleInput = await findUserInput(executor, o.messageId);
  await executor.insert(aiLessons).values({
    status: "PROPOSED",
    origin: o.origin,
    exampleInput: exampleInput?.slice(0, 500) ?? null,
    content: draftLessonText(o),
    sourceMessageId: o.messageId,
  });
}

/**
 * Feedback on a CANCELLED card (web). Stored on the message payload; "the AI
 * got it wrong" also proposes a lesson. One feedback per card.
 */
export async function submitFeedbackCore(
  tx: Tx,
  o: { messageId: number; verdict: FeedbackVerdict; comment: string | null; by: string | null },
): Promise<void> {
  const [msg] = await tx
    .select({ role: aiChatMessages.role, status: aiChatMessages.status, payload: aiChatMessages.parsedPayload })
    .from(aiChatMessages)
    .where(eq(aiChatMessages.id, o.messageId))
    .for("update");
  if (!msg || msg.role !== "ASSISTANT") throw new ActionError("notFound");
  const payload = msg.payload as ChatPayload | null;
  if (msg.status !== "CANCELLED" || !payload?.draft) throw new ActionError("notActionable");
  if (payload.feedback) throw new ActionError("alreadyHandled");

  const feedback: ChatFeedback = { verdict: o.verdict, comment: o.comment, at: new Date().toISOString(), by: o.by };
  await tx
    .update(aiChatMessages)
    .set({ parsedPayload: { ...payload, feedback } as unknown as Record<string, unknown> })
    .where(eq(aiChatMessages.id, o.messageId));

  if (o.verdict === "AI_WRONG") {
    await proposeLesson(tx, { messageId: o.messageId, origin: "CANCEL_FEEDBACK", draft: payload.draft, comment: o.comment });
  }
}
