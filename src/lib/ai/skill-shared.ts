/**
 * Built-in defaults for the AI Cashier skill documents (`ai_skill_docs`).
 * A missing DB row falls back to these; "Restore default" on /skill deletes the row.
 *
 * Client-safe (no server imports): the skill page shows them as the reset preview.
 */

export const SKILL_SLUGS = ["rules", "help_es", "help_en"] as const;
export type SkillSlug = (typeof SKILL_SLUGS)[number];

/** Upper bound per document (keeps the prompt cheap and the help message within Telegram's 4096 chars). */
export const SKILL_DOC_MAX = 6_000;
/** Active lessons injected into the prompt (most recent first). */
export const MAX_ACTIVE_LESSONS = 60;
export const LESSON_MAX = 600;

const RULES = `CONOCIMIENTO DE LA BODEGA (editable por los dueños)

VOCABULARIO
- Métodos de pago: "efectivo", "cash", "en físico" → CASH. "pago móvil", "pm", "transferencia", "por el banco" → PAGO_MOVIL.
  "fiado", "fió", "a crédito", "anótale", "para <nombre>" a crédito → FIADO (necesita cliente).
- Si una venta no dice método de pago, asume CASH y dilo en confidence_notes.
- Abonos: "abonó", "pagó lo que debía", "abono", "paid" → DEBT_PAYMENT. "a Frank" = el dueño que recibe el dinero.
  Si nombra productos, son las unidades que paga. Si solo dice un monto, va en amount y items queda vacío.
- Compras de mercancía: "compra", "compró", "bulto(s)", "caja(s)", "pack" → RESTOCK. La cantidad es el NÚMERO DE BULTOS
  y pack_cost es el costo de UN bulto ("a 6200 cada uno" → 6200; "2 bultos por 12400" → 6200). owner_name = quien compra.
- Movimientos de socios (SETTLEMENT, sin productos; amount = monto, owner_name = el socio):
  "cambio efectivo", "cambio de efectivo", "deposité el efectivo" → CASH_DEPOSIT (el efectivo de la caja pasa al banco).
  "transferencia <socio> <monto>", "le transferí a <socio>" → PAYOUT_TRANSFER (de la cuenta general a la cuenta personal).
  "aporte", "aportó", "metió dinero" → CAPITAL_INJECTION. "retiro", "retiró ganancia" → PROFIT_WITHDRAWAL.
  OJO: "transferencia" en una VENTA con productos es el método PAGO_MOVIL, no un movimiento de socio.
- Palabras de cantidad: "un/una" = 1, "dos" = 2, "par" = 2, "media docena" = 6. Sin número = 1.

PRODUCTOS
- Usa nombre, alias, plurales, diminutivos y errores de tipeo para elegir el SKU
  ("platanitos" → TOM_PLATANITO, "refrescos negros" → REF_NEG, "colita" → REF_KOL, "chinoto" → REF_CHI).
- Si ningún producto encaja, sku = null (no adivines).

CLIENTES Y DUEÑOS
- Copia el cliente tal como se escribió; usa la ortografía del catálogo cuando es claramente la misma persona.
- Los dueños son los co-propietarios (Javi, Frank, Anthony, Mamá). Cada producto pertenece a un dueño.

EJEMPLOS
"Fiado para Mariana: 2 platanitos y 1 chinoto" → SALE, FIADO, cliente "Mariana", items [TOM_PLATANITO×2, REF_CHI×1]
"Vendí 3 refrescos negros pago movil" → SALE, PAGO_MOVIL, items [REF_NEG×3]
"Jonathan abonó 3 refresco negro por pago movil a Frank" → DEBT_PAYMENT, PAGO_MOVIL, cliente "Jonathan", dueño "Frank", items [REF_NEG×3]
"Katiuska abonó 5000 en efectivo a Javi" → DEBT_PAYMENT, CASH, cliente "Katiuska", dueño "Javi", amount 5000, items []
"Frank compra 2 bultos de refresco negro a 6200 cada uno" → RESTOCK, dueño "Frank", items [REF_NEG×2], pack_cost 6200
"Frank cambio efectivo 15400" → SETTLEMENT, CASH_DEPOSIT, dueño "Frank", amount 15400
"Transferencia Frank 3800" → SETTLEMENT, PAYOUT_TRANSFER, dueño "Frank", amount 3800
"Javi aportó 5000" → SETTLEMENT, CAPITAL_INJECTION, dueño "Javi", amount 5000
"Cuanto debe Jonathan?" → DEBT_QUERY, cliente "Jonathan"
"¿Cuánto queda de pepito?" → STOCK_QUERY, items [TOM_PEPITO×0]`;

const HELP_ES = `👋 Cajero IA de BodegaOS
Escribe en palabras normales y te muestro una tarjeta para revisar. No se guarda nada hasta que confirmes.

Qué puedo registrar
• Venta: "Vendí 3 refrescos negros pago móvil"
• Fiado: "Fiado para Mariana: 2 platanitos y 1 chinoto"
• Abono por productos: "Jonathan abonó 3 refresco negro a Frank"
• Abono por monto: "Katiuska abonó 5000 en efectivo a Javi"
• Compra de bultos: "Frank compra 2 bultos de chinoto a 4850 cada uno"
• Cambio de efectivo: "Frank cambio efectivo 15400"
• Transferencia a un socio: "Transferencia Frank 3800"
• Aporte / retiro: "Javi aportó 5000", "Retiro Mamá 2000"

Qué puedo responder
• Deuda: "¿Cuánto debe Jonathan?"
• Stock: "¿Cuánto queda de pepito?"

Consejos
• Si no dices el método de pago, asumo efectivo (lo verás en "Notas de la IA").
• Puedes corregir cualquier campo de la tarjeta antes de confirmar.
• Si cancelas, dime si fue un error tuyo o si yo entendí mal: así aprendo.

Comandos: /help o /ayuda muestra este mensaje.`;

const HELP_EN = `👋 BodegaOS AI Cashier
Write in plain words and I'll show you a card to review. Nothing is saved until you confirm.

What I can log
• Sale: "Sold 3 refresco negro by pago móvil"
• Fiado (credit): "Fiado for Mariana: 2 platanitos and 1 chinoto"
• Abono by products: "Jonathan paid 3 refresco negro to Frank"
• Abono by amount: "Katiuska paid 5000 cash to Javi"
• Restock: "Frank bought 2 packs of chinoto at 4850 each"
• Cash deposit: "Frank cambio efectivo 15400"
• Owner payout: "Transferencia Frank 3800"
• Capital injection / withdrawal: "Javi aportó 5000", "Retiro Mamá 2000"

What I can answer
• Debt: "How much does Jonathan owe?"
• Stock: "How many pepitos are left?"

Tips
• No payment method means cash (you'll see it under "AI notes").
• You can fix any field on the card before confirming.
• If you cancel, tell me whether it was your mistake or mine — that's how I learn.

Commands: /help shows this message.`;

export const SKILL_DEFAULTS: Record<SkillSlug, string> = {
  rules: RULES,
  help_es: HELP_ES,
  help_en: HELP_EN,
};

/** "/help", "/ayuda", "/start" (optionally "@botname" on Telegram). */
export const HELP_COMMAND = /^\/(help|ayuda|start)(@\w+)?\s*$/i;

/* ── Skill page views ─────────────────────────────────────────────────────── */

export type LessonStatus = "PROPOSED" | "ACTIVE" | "ARCHIVED";
export type LessonOrigin = "EDITED_CONFIRM" | "CANCEL_FEEDBACK" | "MANUAL";

export interface LessonView {
  id: number;
  status: LessonStatus;
  origin: LessonOrigin;
  exampleInput: string | null;
  content: string;
  sourceMessageId: number | null;
  /** What the AI proposed / what was saved (from the source chat message), for review context. */
  aiSummary: string | null;
  finalSummary: string | null;
  comment: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewedBy: string | null;
}

export interface FeedbackStats {
  confirmedClean: number;
  confirmedEdited: number;
  cancelledUserError: number;
  cancelledAiWrong: number;
  cancelledNoFeedback: number;
  /** Share of judged cards the AI read correctly (null until there is data). */
  accuracy: number | null;
}

export interface SkillDocData {
  slug: SkillSlug;
  content: string;
  isDefault: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}
