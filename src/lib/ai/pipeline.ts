import "server-only";

import type { ChatStatus } from "@/db/schema";

import { answerDebtQuery, answerStockQuery } from "./answers";
import { loadCatalog, renderCatalog } from "./context";
import { parseWithGemini } from "./gemini";
import { resolveDraft } from "./resolve";
import { isActionIntent, type CashierDraft } from "./shared";
import { loadPromptSkill } from "./skill";

export interface CashierParseResult {
  draft: CashierDraft;
  /** PENDING_CONFIRMATION for ledger intents; INFO for questions / unknown. */
  status: Extract<ChatStatus, "PENDING_CONFIRMATION" | "INFO">;
  /** Assistant bubble text (live SQL answer for queries). */
  reply: string;
}

/** message → live catalog → Gemini → resolver → (live answer for questions). No writes. */
export async function runCashierParse(message: string): Promise<CashierParseResult> {
  const catalog = await loadCatalog();
  const skill = await loadPromptSkill();
  const llm = await parseWithGemini(message, renderCatalog(catalog), skill);
  const draft = resolveDraft(llm, catalog);

  if (isActionIntent(draft.intent)) {
    return { draft, status: "PENDING_CONFIRMATION", reply: draft.reply };
  }
  if (draft.intent === "DEBT_QUERY") {
    const reply = await answerDebtQuery(draft);
    return { draft: { ...draft, reply }, status: "INFO", reply };
  }
  if (draft.intent === "STOCK_QUERY") {
    const reply = answerStockQuery(draft);
    return { draft: { ...draft, reply }, status: "INFO", reply };
  }
  return { draft, status: "INFO", reply: draft.reply };
}
