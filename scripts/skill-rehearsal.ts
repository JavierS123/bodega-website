/**
 * Rehearsal of the AI-skill feedback loop against the live DB, inside ONE
 * transaction that is rolled back at the end (writes nothing). No Gemini calls.
 *
 *   npx tsx --conditions=react-server scripts/skill-rehearsal.ts
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

class Rollback extends Error {}

async function main() {
  const { db } = await import("../src/db");
  const schema = await import("../src/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { commitChatDraft, cancelChatDraftCore } = await import("../src/lib/server/chat-commit");
  const { submitFeedbackCore } = await import("../src/lib/server/ai-feedback");
  const { buildSystemPrompt } = await import("../src/lib/ai/prompt");
  const { SKILL_DEFAULTS } = await import("../src/lib/ai/skill-shared");
  type Draft = import("../src/lib/ai/shared").CashierDraft;

  const prods = await db
    .select()
    .from(schema.products)
    .where(inArray(schema.products.sku, ["REF_CHI", "REF_NEG"]));
  const chi = prods.find((p) => p.sku === "REF_CHI")!;
  const neg = prods.find((p) => p.sku === "REF_NEG")!;
  const item = (p: typeof chi) => ({
    product_id: p.id, sku: p.sku, name: p.name, query: "negrito", quantity: 1,
    unit_price: p.salePrice, current_stock: p.currentStock, owner_id: p.ownerId, owner_name: null, stock_warning: false,
  });
  const base: Draft = {
    intent: "SALE", language: "es", payment_method: "PAGO_MOVIL", client_name: null, client_id: null,
    is_new_client: false, owner_name: null, owner_id: null, items: [item(chi)], pack_cost: null, amount: null,
    total_amount: chi.salePrice, confidence_notes: "", reply: "Venta de 1 Refresco Chinoto por pago móvil.",
  };
  const check = (ok: boolean, label: string) => {
    console.log(`${ok ? "✓" : "✖"} ${label}`);
    if (!ok) process.exitCode = 1;
  };

  try {
    await db.transaction(async (tx) => {
      const pair = async (text: string) => {
        await tx.insert(schema.aiChatMessages).values({ role: "USER", source: "WEB", content: text, status: "INFO" });
        const [a] = await tx
          .insert(schema.aiChatMessages)
          .values({ role: "ASSISTANT", source: "WEB", content: base.reply, status: "PENDING_CONFIRMATION", parsedPayload: { v: 1, draft: base } })
          .returning({ id: schema.aiChatMessages.id });
        return a.id;
      };

      // 1. Confirm unchanged → no proposal, edited=false.
      const m1 = await pair("vendí un chinoto por pm");
      await commitChatDraft(tx, { messageId: m1, draft: base, source: "WEB_AI" });
      const [r1] = await tx.select().from(schema.aiChatMessages).where(eq(schema.aiChatMessages.id, m1));
      const l1 = await tx.select().from(schema.aiLessons).where(eq(schema.aiLessons.sourceMessageId, m1));
      check((r1.parsedPayload as { edited?: boolean }).edited === false && l1.length === 0, "clean confirm: edited=false, no proposal");

      // 2. Confirm after swapping Chinoto → Negro → PROPOSED lesson with example input.
      const m2 = await pair("dame un negrito por pm");
      await commitChatDraft(tx, { messageId: m2, draft: { ...base, items: [item(neg)] }, source: "WEB_AI" });
      const l2 = await tx.select().from(schema.aiLessons).where(eq(schema.aiLessons.sourceMessageId, m2));
      check(l2.length === 1 && l2[0].status === "PROPOSED" && l2[0].origin === "EDITED_CONFIRM", "edited confirm → 1 PROPOSED lesson");
      check(l2[0]?.exampleInput === "dame un negrito por pm", `example input captured («${l2[0]?.exampleInput}»)`);
      console.log(`   draft text: ${l2[0]?.content}`);

      // 3. Cancel + "AI got it wrong" with a comment → proposal; second feedback rejected.
      const m3 = await pair("un negrito fiado a Katiuska");
      await cancelChatDraftCore(tx, m3);
      await submitFeedbackCore(tx, { messageId: m3, verdict: "AI_WRONG", comment: "negrito es Refresco Negro", by: "test" });
      const l3 = await tx.select().from(schema.aiLessons).where(eq(schema.aiLessons.sourceMessageId, m3));
      check(l3.length === 1 && l3[0].origin === "CANCEL_FEEDBACK" && l3[0].content.includes("negrito es Refresco Negro"), "AI_WRONG feedback → proposal with comment");
      let rejected = false;
      try {
        await submitFeedbackCore(tx, { messageId: m3, verdict: "USER_ERROR", comment: null, by: "test" });
      } catch {
        rejected = true;
      }
      check(rejected, "second feedback on the same card is rejected");

      // 4. Cancel + "my mistake" → stored, no proposal.
      const m4 = await pair("vendí un chinoto");
      await cancelChatDraftCore(tx, m4);
      await submitFeedbackCore(tx, { messageId: m4, verdict: "USER_ERROR", comment: null, by: "test" });
      const l4 = await tx.select().from(schema.aiLessons).where(eq(schema.aiLessons.sourceMessageId, m4));
      check(l4.length === 0, "USER_ERROR feedback → no proposal");

      // 5. Feedback on a still-pending card is not allowed.
      const m5 = await pair("x");
      let notActionable = false;
      try {
        await submitFeedbackCore(tx, { messageId: m5, verdict: "AI_WRONG", comment: null, by: "test" });
      } catch {
        notActionable = true;
      }
      check(notActionable, "feedback on a pending card is rejected");

      // 6. Approved lesson reaches the prompt.
      await tx.update(schema.aiLessons).set({ status: "ACTIVE", content: "«negrito» es Refresco Negro (REF_NEG), no Chinoto." }).where(eq(schema.aiLessons.id, l2[0].id));
      const active = await tx
        .select({ id: schema.aiLessons.id, content: schema.aiLessons.content, exampleInput: schema.aiLessons.exampleInput })
        .from(schema.aiLessons)
        .where(eq(schema.aiLessons.status, "ACTIVE"));
      const prompt = buildSystemPrompt("CATALOG…", { rules: SKILL_DEFAULTS.rules, lessons: active });
      check(prompt.includes("LEARNED LESSONS") && prompt.includes("«negrito» es Refresco Negro"), "active lesson injected into the system prompt");
      check(!buildSystemPrompt("C", { rules: "R", lessons: [] }).includes("LEARNED LESSONS"), "no lessons → no lessons block");

      // 7. SETTLEMENT confirm ("Frank cambio efectivo 15400") → one owner_settlements row, no ledger transaction.
      const [frank] = await tx.select().from(schema.owners).where(eq(schema.owners.name, "Frank"));
      const mv: Draft = {
        ...base, intent: "SETTLEMENT", payment_method: null, items: [], owner_id: frank.id, owner_name: "Frank",
        settlement_type: "CASH_DEPOSIT", settlement_method: "CASH", amount: "15400.00", total_amount: "15400.00",
        reply: "Cambio de efectivo de Frank por 15400.",
      };
      await tx.insert(schema.aiChatMessages).values({ role: "USER", source: "WEB", content: "Frank cambio efectivo 15400", status: "INFO" });
      const [a7] = await tx
        .insert(schema.aiChatMessages)
        .values({ role: "ASSISTANT", source: "WEB", content: mv.reply, status: "PENDING_CONFIRMATION", parsedPayload: { v: 1, draft: mv } })
        .returning({ id: schema.aiChatMessages.id });
      const r7 = await commitChatDraft(tx, { messageId: a7.id, draft: mv, source: "WEB_AI" });
      const [st] = await tx.select().from(schema.ownerSettlements).where(eq(schema.ownerSettlements.id, r7.settlementId ?? -1));
      const [m7] = await tx.select().from(schema.aiChatMessages).where(eq(schema.aiChatMessages.id, a7.id));
      check(
        r7.transactionId === null && st?.type === "CASH_DEPOSIT" && st.paymentMethod === "CASH" && st.amount === "15400.00" && st.ownerId === frank.id,
        `settlement confirm → owner_settlements #${r7.settlementId} CASH_DEPOSIT 15400 (no ledger tx)`,
      );
      check(
        m7.status === "CONFIRMED" && m7.linkedTransactionId === null && (m7.parsedPayload as { settlementId?: number }).settlementId === r7.settlementId,
        "chat message CONFIRMED with payload.settlementId",
      );
      // An invalid method for the type is rejected (a payout can't be cash).
      const bad = { ...mv, settlement_type: "PAYOUT_TRANSFER" as const, settlement_method: "CASH" as const };
      const [a8] = await tx
        .insert(schema.aiChatMessages)
        .values({ role: "ASSISTANT", source: "WEB", content: "x", status: "PENDING_CONFIRMATION", parsedPayload: { v: 1, draft: bad } })
        .returning({ id: schema.aiChatMessages.id });
      let rejectedMethod = false;
      try {
        await tx.transaction((sp) => commitChatDraft(sp, { messageId: a8.id, draft: bad, source: "WEB_AI" }));
      } catch {
        rejectedMethod = true;
      }
      check(rejectedMethod, "payout by CASH is rejected");

      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
    console.log("↺ rolled back — database unchanged");
  }
  process.exit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
