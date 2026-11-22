"use client";

import { ArrowRight, ClipboardCheck, Loader2 } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { adjustStock } from "@/actions/inventory";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { interpolate } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import { ADJUSTMENT_REASONS, type AdjustmentReason, type InventoryProduct } from "@/lib/inventory/shared";
import { cn } from "@/lib/utils";

import { StockPill } from "./badges";
import { FormField } from "./form-field";

export function AdjustStockDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: InventoryProduct;
}) {
  const { t } = useI18n();
  const a = t.inventory.adjust;
  const [pending, startTransition] = useTransition();

  // Negative stock almost always means a restock was never recorded.
  const [reason, setReason] = useState<AdjustmentReason | "">(
    product.currentStock < 0 ? "UNRECORDED_RESTOCK" : "",
  );
  const [actual, setActual] = useState("");
  const [details, setDetails] = useState("");

  const system = product.currentStock;
  const count = actual === "" ? null : Number.parseInt(actual, 10);
  const validCount = count !== null && Number.isInteger(count) && count >= 0;
  const delta = validCount ? count - system : null;
  const needsDetails = reason === "OTHER" && details.trim().length < 3;
  const canSubmit = validCount && delta !== 0 && reason !== "" && !needsDetails;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || count === null) return;
    startTransition(async () => {
      const result = await adjustStock({
        productId: product.id,
        actualCount: count,
        expectedStock: system,
        reason,
        details: details.trim(),
      });
      if (result.ok) {
        toast.success(interpolate(a.success, { product: product.name, count: result.data.newStock }), {
          description: `${product.sku} · ${result.data.delta > 0 ? "+" : ""}${result.data.delta} u`,
        });
        onOpenChange(false);
      } else {
        toast.error(t.inventory.errors[result.error]);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="size-4 text-sky-600" aria-hidden />
            {a.title}
          </DialogTitle>
          <DialogDescription>{a.description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-0.5 rounded-lg border px-3 py-2">
          <span className="truncate font-medium">{product.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{product.sku}</span>
        </div>

        <form id="adjust-form" onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">{a.systemStock}</span>
              <div className="flex h-8 items-center">
                <StockPill stock={system} threshold={product.lowStockThreshold} />
              </div>
            </div>
            <ArrowRight className="mb-2 size-4 text-muted-foreground" aria-hidden />
            <FormField label={a.actualCount} htmlFor="a-actual">
              <Input
                id="a-actual"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                required
                autoFocus
                className="tabular-nums"
              />
            </FormField>
          </div>

          <div
            aria-live="polite"
            className={cn(
              "flex items-center justify-between rounded-lg px-3 py-2.5 text-sm",
              delta === null || delta === 0
                ? "bg-muted/60 text-muted-foreground"
                : delta > 0
                  ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300",
            )}
          >
            <span className="font-medium">{a.delta}</span>
            <span className="font-mono text-xs">
              {validCount ? `${count} − (${system}) = ` : ""}
              <span className="text-base font-semibold tabular-nums">
                {delta === null ? "—" : delta === 0 ? a.deltaNone : `${delta > 0 ? "+" : ""}${delta} u`}
              </span>
            </span>
          </div>

          <FormField label={a.reason} htmlFor="a-reason">
            <Select value={reason} onValueChange={(v) => setReason(v as AdjustmentReason)} required>
              <SelectTrigger id="a-reason" className="w-full">
                <SelectValue placeholder={a.reasonPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {ADJUSTMENT_REASONS.map((code) => (
                  <SelectItem key={code} value={code}>
                    {a.reasons[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label={a.details} htmlFor="a-details" invalid={needsDetails && details.length > 0}>
            <Input
              id="a-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={a.detailsPlaceholder}
              maxLength={200}
              required={reason === "OTHER"}
              minLength={reason === "OTHER" ? 3 : undefined}
            />
          </FormField>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t.inventory.form.cancel}
          </Button>
          <Button type="submit" form="adjust-form" disabled={pending || !canSubmit}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <ClipboardCheck aria-hidden />}
            {pending ? a.submitting : a.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
