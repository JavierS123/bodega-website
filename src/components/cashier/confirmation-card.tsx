"use client";

import { AlertTriangle, Ban, Check, CircleCheck, ExternalLink, Loader2, Plus, Sparkles, Trash2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { cancelChatDraft, confirmChatDraft } from "@/actions/chat";
import { AbonoPreview } from "@/components/clients/abono-preview";
import { OwnerBadge } from "@/components/inventory/badges";
import { Pill, PillGroup } from "@/components/shared/filter-pills";
import { OptionSelect } from "@/components/shared/option-select";
import { MethodBadge, TypeBadge } from "@/components/transactions/badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applyStockWarnings, computeTotal } from "@/lib/ai/draft";
import type { CashierDraft, ChatMessageView, DraftItem } from "@/lib/ai/shared";
import type { OpenDebt } from "@/lib/clients/shared";
import { formatCurrency, toShopDateKey } from "@/lib/format";
import { interpolate } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import type { OwnerOption } from "@/lib/inventory/shared";
import { centsToDecimal, toCents, tryCents } from "@/lib/money";
import type { ClientOption, SaleProductOption } from "@/lib/transactions/shared";
import { cn } from "@/lib/utils";

export interface CardCatalog {
  products: SaleProductOption[];
  clients: ClientOption[];
  owners: OwnerOption[];
  /** Open Fiado debts (balances + owed units, oldest first) for abono previews and checks. */
  debts: OpenDebt[];
}

/** Patch applied to a chat message after confirm / cancel. */
export type MessageUpdate = Pick<ChatMessageView, "status" | "linkedTransactionId" | "payload">;

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/**
 * Human-in-the-loop Confirmation Card. While PENDING every field is editable
 * inline; Confirm & Save writes the ledger atomically (admins) or shows a
 * simulated-commit toast (visitors). Confirmed / cancelled cards render
 * read-only with their final state.
 */
export function ConfirmationCard({
  message,
  catalog,
  isAdmin,
  onUpdate,
}: {
  message: ChatMessageView;
  catalog: CardCatalog;
  isAdmin: boolean;
  onUpdate: (id: number, update: MessageUpdate) => void;
}) {
  const { t } = useI18n();
  const c = t.cashier.card;
  const payload = message.payload!;
  const pending = message.status === "PENDING_CONFIRMATION";
  const [draft, setDraft] = useState<CashierDraft>(() => structuredClone(payload.final ?? payload.draft));
  const [saving, startSaving] = useTransition();
  const [showErrors, setShowErrors] = useState(false);

  const update = (patch: Partial<CashierDraft>) =>
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      if (next.intent === "SALE") next.items = applyStockWarnings(next.items.map((i) => ({ ...i })));
      next.total_amount = computeTotal(next);
      return next;
    });
  const setItem = (index: number, patch: Partial<DraftItem>) =>
    update({ items: draft.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) });
  const pickProduct = (index: number, productId: number | null) => {
    const p = catalog.products.find((x) => x.id === productId);
    setItem(index, {
      product_id: p?.id ?? null,
      sku: p?.sku ?? null,
      name: p?.name ?? null,
      unit_price: p?.salePrice ?? null,
      current_stock: p?.currentStock ?? null,
      owner_id: p?.ownerId ?? null,
      owner_name: p?.ownerName ?? null,
    });
  };
  const setClientName = (name: string) => {
    const match = catalog.clients.find((x) => fold(x.name) === fold(name));
    update({
      client_name: name || null,
      client_id: match?.id ?? null,
      // Only a sale can create a client; abonos need an existing debtor.
      is_new_client: !match && Boolean(name.trim()) && draft.intent === "SALE",
    });
  };

  // Debt context for abonos (live data from the page; the server re-checks on confirm).
  const clientDebts = draft.client_id ? catalog.debts.filter((d) => d.clientId === draft.client_id) : [];
  const ownerDebt = clientDebts.find((d) => d.ownerId === draft.owner_id);
  const owedUnits = (productId: number | null) =>
    productId === null ? 0 : clientDebts.reduce((n, d) => n + d.units.filter((u) => u.productId === productId && u.qty > 0).reduce((a, u) => a + u.qty, 0), 0);

  const problems = validate(draft, catalog.debts);
  const invalid = (key: Problem) => showErrors && problems.has(key);

  function confirm() {
    if (problems.size > 0) {
      setShowErrors(true);
      toast.error(c.incomplete);
      return;
    }
    if (!isAdmin || message.sandbox) {
      toast.success(t.cashier.toasts.simulated);
      onUpdate(message.id, {
        status: "CONFIRMED",
        linkedTransactionId: null,
        payload: { ...payload, final: draft },
      });
      return;
    }
    startSaving(async () => {
      const result = await confirmChatDraft({ messageId: message.id, draft });
      if (result.ok) {
        toast.success(interpolate(t.cashier.toasts.confirmed, { id: result.data.transactionId }));
        onUpdate(message.id, {
          status: "CONFIRMED",
          linkedTransactionId: result.data.transactionId,
          payload: { ...payload, final: draft },
        });
      } else {
        toast.error(t.cashier.errors[result.error]);
      }
    });
  }

  function cancel() {
    if (!isAdmin || message.sandbox) {
      onUpdate(message.id, { status: "CANCELLED", linkedTransactionId: null, payload });
      return;
    }
    startSaving(async () => {
      const result = await cancelChatDraft({ messageId: message.id });
      if (result.ok) {
        toast(t.cashier.toasts.cancelled);
        onUpdate(message.id, { status: "CANCELLED", linkedTransactionId: null, payload });
      } else {
        toast.error(t.cashier.errors[result.error]);
      }
    });
  }

  /* ── Read-only (final states) ─────────────────────────────────────────── */
  if (!pending) {
    return (
      <ResolvedCard
        message={message}
        draft={payload.final ?? payload.draft}
        edited={Boolean(payload.final) && wasEdited(payload.draft, payload.final!)}
      />
    );
  }

  /* ── Editable ─────────────────────────────────────────────────────────── */
  const isSale = draft.intent === "SALE";
  const isDebt = draft.intent === "DEBT_PAYMENT";
  const isRestock = draft.intent === "RESTOCK";
  const methods = isSale ? (["CASH", "PAGO_MOVIL", "FIADO"] as const) : (["CASH", "PAGO_MOVIL"] as const);
  const productOptions = catalog.products.map((p) => ({ value: p.id, label: `${p.name} · ${formatCurrency(p.salePrice)}` }));
  const listId = `clients-${message.id}`;

  return (
    <div className="grid gap-3 rounded-xl border bg-card p-3 text-sm shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-primary" aria-hidden />
          <TypeBadge type={draft.intent as "SALE" | "DEBT_PAYMENT" | "RESTOCK"} />
        </span>
        <span className="text-base font-semibold tabular-nums">{formatCurrency(draft.total_amount)}</span>
      </div>

      {/* Lines */}
      {(draft.items.length > 0 || !isDebt) && (
        <div className="grid gap-2">
          {draft.items.map((item, index) => (
            <div key={index} className="grid gap-1">
              <div className="flex items-center gap-2">
                <OptionSelect
                  value={item.product_id}
                  onChange={(v) => pickProduct(index, v)}
                  options={productOptions}
                  placeholder={c.productPlaceholder}
                  ariaLabel={c.product}
                  size="sm"
                  className="flex-1"
                  invalid={invalid("items") && !item.product_id}
                />
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={item.quantity || ""}
                  onChange={(e) => setItem(index, { quantity: Math.max(0, Number.parseInt(e.target.value, 10) || 0) })}
                  aria-label={isRestock ? c.packs : c.qty}
                  aria-invalid={(invalid("items") && item.quantity < 1) || undefined}
                  className="h-7 w-16 text-right tabular-nums"
                />
                {!isRestock && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={c.removeItem}
                    onClick={() => update({ items: draft.items.filter((_, i) => i !== index) })}
                    disabled={isSale && draft.items.length === 1}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  {item.owner_id && item.owner_name && <OwnerBadge ownerId={item.owner_id} name={item.owner_name} />}
                  {!item.product_id && (
                    <span className="text-warning">{interpolate(c.unmatched, { query: item.query })}</span>
                  )}
                  {isDebt && draft.client_id && item.product_id && item.quantity > owedUnits(item.product_id) && (
                    <span className="flex items-center gap-1 text-destructive">
                      <AlertTriangle className="size-3" aria-hidden />
                      {interpolate(c.owesOnlyUnits, { count: owedUnits(item.product_id) })}
                    </span>
                  )}
                  {item.stock_warning && item.current_stock !== null && (
                    <span className="flex items-center gap-1 text-warning">
                      <AlertTriangle className="size-3" aria-hidden />
                      {interpolate(c.stockWarning, { stock: item.current_stock })}
                    </span>
                  )}
                </span>
                {!isRestock && item.unit_price && (
                  <span className="tabular-nums">
                    {item.quantity} × {formatCurrency(item.unit_price)} ={" "}
                    <span className="font-medium text-foreground">
                      {formatCurrency(centsToDecimal(item.quantity * toCents(item.unit_price)))}
                    </span>
                  </span>
                )}
              </div>
            </div>
          ))}
          {!isRestock && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="justify-self-start"
              onClick={() =>
                update({
                  items: [
                    ...draft.items,
                    { product_id: null, sku: null, name: null, query: "", quantity: 1, unit_price: null, current_stock: null, owner_id: null, owner_name: null, stock_warning: false },
                  ],
                })
              }
            >
              <Plus aria-hidden />
              {c.addItem}
            </Button>
          )}
        </div>
      )}

      {isRestock && (
        <label className="grid gap-1 text-xs text-muted-foreground">
          {c.packCost}
          <Input
            type="number"
            inputMode="decimal"
            min={0.01}
            step="0.01"
            value={draft.pack_cost ?? ""}
            onChange={(e) => update({ pack_cost: tryCents(e.target.value) ? centsToDecimal(tryCents(e.target.value)!) : null })}
            aria-invalid={invalid("packCost") || undefined}
            className="h-7 tabular-nums"
          />
        </label>
      )}

      {/* Payment method */}
      {(isSale || isDebt) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{c.method}</span>
          <PillGroup label={c.method} className={cn("rounded-lg bg-muted p-0.5", invalid("method") && "ring-1 ring-destructive")} segmented>
            {methods.map((m) => (
              <Pill key={m} active={draft.payment_method === m} onClick={() => update({ payment_method: m })} segmented>
                {t.enums.method[m]}
              </Pill>
            ))}
          </PillGroup>
        </div>
      )}

      {/* Client */}
      {(isDebt || (isSale && (draft.payment_method === "FIADO" || draft.client_name))) && (
        <div className="grid gap-1">
          <label className="grid gap-1 text-xs text-muted-foreground">
            {c.client}
            <Input
              list={listId}
              value={draft.client_name ?? ""}
              onChange={(e) => setClientName(e.target.value)}
              placeholder={c.clientPlaceholder}
              aria-invalid={invalid("client") || undefined}
              className="h-7"
            />
          </label>
          <datalist id={listId}>
            {catalog.clients.map((cl) => (
              <option key={cl.id} value={cl.name} />
            ))}
          </datalist>
          {draft.is_new_client && (
            <span className="flex items-center gap-1 text-xs text-info">
              <UserPlus className="size-3" aria-hidden />
              {c.newClient}
            </span>
          )}
        </div>
      )}

      {/* Abono by amount */}
      {isDebt && draft.items.length === 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            {c.owner}
            <OptionSelect
              value={draft.owner_id}
              onChange={(v) => update({ owner_id: v, owner_name: catalog.owners.find((o) => o.id === v)?.name ?? null })}
              options={(clientDebts.length > 0 ? clientDebts.filter((d) => toCents(d.balance) > 0) : catalog.owners).map((o) =>
                "clientId" in o
                  ? { value: o.ownerId, label: `${o.ownerName} — ${interpolate(c.owes, { amount: formatCurrency(o.balance) })}` }
                  : { value: o.id, label: o.name },
              )}
              placeholder={c.ownerPlaceholder}
              size="sm"
              invalid={invalid("owner")}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {c.amount}
            <Input
              type="number"
              inputMode="decimal"
              min={0.01}
              step="0.01"
              value={draft.amount ?? ""}
              onChange={(e) => update({ amount: tryCents(e.target.value) ? centsToDecimal(tryCents(e.target.value)!) : null })}
              aria-invalid={invalid("amount") || undefined}
              className="h-7 tabular-nums"
            />
          </label>
          <div className="grid gap-1.5 sm:col-span-2">
            {ownerDebt ? (
              <>
                <span className="text-xs text-muted-foreground">
                  {interpolate(c.owesOwner, {
                    client: draft.client_name ?? "",
                    owner: ownerDebt.ownerName,
                    amount: formatCurrency(ownerDebt.balance),
                  })}
                </span>
                {draft.amount && toCents(draft.amount) > toCents(ownerDebt.balance) ? (
                  <span className="flex items-center gap-1 text-xs text-destructive">
                    <AlertTriangle className="size-3" aria-hidden />
                    {t.cashier.errors.exceedsDebt}
                  </span>
                ) : (
                  <AbonoPreview units={ownerDebt.units} amountCents={draft.amount ? toCents(draft.amount) : null} />
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {draft.client_id && draft.owner_id ? c.noDebtWithOwner : c.amountHint}
              </p>
            )}
          </div>
        </div>
      )}
      {isDebt && draft.items.length > 0 && <p className="text-xs text-muted-foreground">{c.unitsOrAmount}</p>}

      {draft.confidence_notes && (
        <p className="rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
          <span className="font-medium">{c.notes}: </span>
          {draft.confidence_notes}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={saving}>
          <Ban aria-hidden />
          {c.cancel}
        </Button>
        <Button type="button" size="sm" onClick={confirm} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
          {saving ? c.confirming : c.confirm}
        </Button>
      </div>
    </div>
  );
}

/* ── Validation ─────────────────────────────────────────────────────────── */

type Problem = "items" | "method" | "client" | "owner" | "amount" | "packCost";

function validate(d: CashierDraft, debts: OpenDebt[]): Set<Problem> {
  const p = new Set<Problem>();
  const linesOk = d.items.every((i) => i.product_id && i.quantity >= 1);
  if (d.intent === "SALE") {
    if (d.items.length === 0 || !linesOk) p.add("items");
    if (!d.payment_method) p.add("method");
    if (d.payment_method === "FIADO" && !d.client_id && !(d.is_new_client && d.client_name?.trim())) p.add("client");
  } else if (d.intent === "DEBT_PAYMENT") {
    if (!d.client_id) p.add("client");
    if (d.payment_method !== "CASH" && d.payment_method !== "PAGO_MOVIL") p.add("method");
    const mine = debts.filter((x) => x.clientId === d.client_id);
    if (d.items.length > 0) {
      const owed = (productId: number | null) =>
        mine.reduce((n, x) => n + x.units.filter((u) => u.productId === productId && u.qty > 0).reduce((a, u) => a + u.qty, 0), 0);
      if (!linesOk || d.items.some((i) => i.quantity > owed(i.product_id))) p.add("items");
    } else {
      const balance = mine.find((x) => x.ownerId === d.owner_id)?.balance;
      if (!d.owner_id || !balance || toCents(balance) <= 0) p.add("owner");
      if (!d.amount || toCents(d.amount) <= 0 || (balance && toCents(d.amount) > toCents(balance))) p.add("amount");
    }
  } else if (d.intent === "RESTOCK") {
    if (d.items.length !== 1 || !linesOk) p.add("items");
    if (!d.pack_cost || toCents(d.pack_cost) <= 0) p.add("packCost");
  }
  return p;
}

/** Did the human change what the AI proposed? (Totals are ignored: prices may move between parse and confirm.) */
function wasEdited(a: CashierDraft, b: CashierDraft): boolean {
  const key = (d: CashierDraft) =>
    JSON.stringify([
      d.payment_method,
      d.client_name?.trim().toLowerCase() ?? null,
      d.owner_id,
      d.pack_cost,
      d.amount,
      d.items.map((i) => [i.product_id, i.quantity]),
    ]);
  return key(a) !== key(b);
}

/* ── Final states ───────────────────────────────────────────────────────── */

function ResolvedCard({ message, draft, edited }: { message: ChatMessageView; draft: CashierDraft; edited: boolean }) {
  const { t } = useI18n();
  const c = t.cashier.card;
  const confirmed = message.status === "CONFIRMED";
  const day = toShopDateKey(message.createdAt);

  return (
    <div
      className={cn(
        "grid gap-2 rounded-xl border p-3 text-sm",
        confirmed ? "border-success/30 bg-success/5" : "bg-muted/40 text-muted-foreground",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <TypeBadge type={draft.intent as "SALE" | "DEBT_PAYMENT" | "RESTOCK"} />
          {draft.payment_method && <MethodBadge method={draft.payment_method} />}
        </span>
        <span className={cn("font-semibold tabular-nums", !confirmed && "line-through")}>
          {formatCurrency(draft.total_amount)}
        </span>
      </div>
      <p className={cn("text-xs", !confirmed && "line-through")}>
        {[
          draft.items.map((i) => `${i.quantity} × ${i.name ?? i.query}`).join(", "),
          draft.client_name,
          draft.items.length === 0 && draft.owner_name ? `→ ${draft.owner_name}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {confirmed ? (
          <span className="flex items-center gap-1 font-medium text-success">
            <CircleCheck className="size-3.5" aria-hidden />
            {message.linkedTransactionId
              ? interpolate(c.confirmed, { id: message.linkedTransactionId })
              : c.confirmedNoTx}
            {message.sandbox && <span className="font-normal text-muted-foreground">· {t.cashier.sandboxBadge}</span>}
          </span>
        ) : (
          <span className="flex items-center gap-1 font-medium">
            <Ban className="size-3.5" aria-hidden />
            {c.cancelled}
          </span>
        )}
        <span className="flex items-center gap-2">
          {confirmed && edited && <span className="text-muted-foreground italic">{c.edited}</span>}
          {message.linkedTransactionId && (
            <Link
              href={`/transactions?from=${day}&to=${day}`}
              className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
            >
              {c.viewTx}
              <ExternalLink className="size-3" aria-hidden />
            </Link>
          )}
        </span>
      </div>
    </div>
  );
}
