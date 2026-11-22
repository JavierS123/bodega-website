"use client";

import { AlertTriangle, Loader2, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { createManualSale } from "@/actions/transactions";
import { OwnerBadge } from "@/components/inventory/badges";
import { Pill, PillGroup } from "@/components/shared/filter-pills";
import { FormField } from "@/components/shared/form-field";
import { OptionSelect } from "@/components/shared/option-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/format";
import { interpolate } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import { tryCents } from "@/lib/money";
import {
  localInputToIso,
  SALE_METHODS,
  type ClientOption,
  type SaleMethod,
  type SaleProductOption,
} from "@/lib/transactions/shared";

interface Line {
  key: number;
  productId: number | null;
  qty: string;
}

let nextKey = 1;
const newLine = (): Line => ({ key: nextKey++, productId: null, qty: "1" });

export function ManualSaleDialog({
  open,
  onOpenChange,
  products,
  clients,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: SaleProductOption[];
  clients: ClientOption[];
}) {
  const { t } = useI18n();
  const s = t.transactions.sale;
  const [pending, startTransition] = useTransition();

  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [method, setMethod] = useState<SaleMethod>("CASH");
  const [clientId, setClientId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  const byId = new Map(products.map((p) => [p.id, p]));
  // Units requested per product across lines (for the stock warning).
  const requested = new Map<number, number>();
  for (const l of lines) {
    const q = Number.parseInt(l.qty, 10);
    if (l.productId && q > 0) requested.set(l.productId, (requested.get(l.productId) ?? 0) + q);
  }

  const lineCents = (l: Line) => {
    const p = l.productId ? byId.get(l.productId) : undefined;
    const q = Number.parseInt(l.qty, 10);
    return p && q > 0 ? q * (tryCents(p.salePrice) ?? 0) : null;
  };
  const totalCents = lines.reduce((sum, l) => sum + (lineCents(l) ?? 0), 0);

  const linesValid = lines.length > 0 && lines.every((l) => l.productId && Number.parseInt(l.qty, 10) >= 1);
  const clientMissing = method === "FIADO" && !clientId;
  const valid = linesValid && !clientMissing;

  const update = (key: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) {
      setShowErrors(true);
      return;
    }
    startTransition(async () => {
      const result = await createManualSale({
        items: lines.map((l) => ({ productId: l.productId!, qty: Number.parseInt(l.qty, 10) })),
        paymentMethod: method,
        clientId,
        notes,
        occurredAt: localInputToIso(occurredAt),
      });
      if (result.ok) {
        toast.success(interpolate(s.success, { total: formatCurrency(result.data.total) }), {
          description: `#${result.data.id}`,
        });
        onOpenChange(false);
      } else {
        toast.error(t.transactions.errors[result.error]);
      }
    });
  }

  const productOptions = products.map((p) => ({
    value: p.id,
    label: `${p.name} · ${formatCurrency(p.salePrice)}`,
  }));

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="size-4 text-success" aria-hidden />
            {s.title}
          </DialogTitle>
          <DialogDescription>{s.description}</DialogDescription>
        </DialogHeader>

        <form id="sale-form" onSubmit={handleSubmit} className="grid gap-4">
          {/* ── Lines ── */}
          <div className="grid gap-2">
            {lines.map((l, index) => {
              const product = l.productId ? byId.get(l.productId) : undefined;
              const want = product ? (requested.get(product.id) ?? 0) : 0;
              const short = product && want > product.currentStock;
              const cents = lineCents(l);
              return (
                <div key={l.key} className="grid gap-1.5 rounded-lg border p-2">
                  <div className="flex items-end gap-2">
                    <div className="grid min-w-0 flex-1 gap-1">
                      <Label htmlFor={`s-p-${l.key}`} className="text-xs text-muted-foreground">
                        {s.product} {index + 1}
                      </Label>
                      <OptionSelect
                        id={`s-p-${l.key}`}
                        value={l.productId}
                        onChange={(v) => update(l.key, { productId: v })}
                        options={productOptions}
                        placeholder={s.productPlaceholder}
                        invalid={showErrors && !l.productId}
                      />
                    </div>
                    <div className="grid w-20 gap-1">
                      <Label htmlFor={`s-q-${l.key}`} className="text-xs text-muted-foreground">
                        {s.qty}
                      </Label>
                      <Input
                        id={`s-q-${l.key}`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={l.qty}
                        onChange={(e) => update(l.key, { qty: e.target.value })}
                        aria-invalid={(showErrors && !(Number.parseInt(l.qty, 10) >= 1)) || undefined}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                      disabled={lines.length === 1}
                      aria-label={s.removeLine}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                  {product && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <OwnerBadge ownerId={product.ownerId} name={product.ownerName} />
                        <span className="tabular-nums">{product.currentStock} u</span>
                      </span>
                      <span className="font-medium tabular-nums">{cents === null ? "—" : formatCurrency(cents / 100)}</span>
                    </div>
                  )}
                  {short && (
                    <p className="flex items-center gap-1 text-xs text-warning">
                      <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                      {interpolate(s.stockWarning, { stock: product.currentStock })}
                    </p>
                  )}
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => setLines((prev) => [...prev, newLine()])}
              disabled={lines.length >= 50}
            >
              <Plus aria-hidden />
              {s.addLine}
            </Button>
          </div>

          {/* ── Payment ── */}
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">{s.method}</span>
            <PillGroup label={s.method} className="justify-self-start rounded-lg bg-muted p-0.5" segmented>
              {SALE_METHODS.map((m) => (
                <Pill key={m} active={method === m} onClick={() => setMethod(m)} segmented>
                  {t.enums.method[m]}
                </Pill>
              ))}
            </PillGroup>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={s.client}
              htmlFor="s-client"
              invalid={showErrors && clientMissing}
              hint={method === "FIADO" ? s.clientRequired : t.common.optional}
            >
              <OptionSelect
                id="s-client"
                value={clientId}
                onChange={setClientId}
                options={clients.map((c) => ({ value: c.id, label: c.name }))}
                placeholder={s.clientPlaceholder}
                allLabel={method === "FIADO" ? undefined : "—"}
                invalid={showErrors && clientMissing}
              />
            </FormField>
            <FormField label={s.occurredAt} htmlFor="s-date" hint={s.occurredAtHint}>
              <Input
                id="s-date"
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </FormField>
          </div>

          <FormField label={s.notes} htmlFor="s-notes">
            <Input
              id="s-notes"
              value={notes}
              maxLength={300}
              placeholder={s.notesPlaceholder}
              onChange={(e) => setNotes(e.target.value)}
            />
          </FormField>

          <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2" aria-live="polite">
            <span className="text-sm text-muted-foreground">{s.total}</span>
            <span className="text-lg font-semibold tabular-nums">{formatCurrency(totalCents / 100)}</span>
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form="sale-form" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <ShoppingCart aria-hidden />}
            {pending ? s.submitting : s.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
