"use client";

import { Ban, Loader2 } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { voidSettlement } from "@/actions/owners";
import { voidTransaction } from "@/actions/transactions";
import { FormField } from "@/components/shared/form-field";
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
import { formatCurrency } from "@/lib/format";
import { interpolate } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import type { LedgerRow } from "@/lib/transactions/shared";

import { MethodBadge, TypeBadge } from "./badges";

export function VoidTransactionDialog({
  open,
  onOpenChange,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: LedgerRow;
}) {
  const { t } = useI18n();
  const v = t.transactions.void;
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= 3;

  // Mirror of what voidTransaction() reverses (stock) and what the debt view will stop counting.
  const stockEffects = row.items.map((i) => ({
    key: i.id,
    text: interpolate(v.stockBack, {
      product: i.productName,
      delta: -i.quantityDelta > 0 ? `+${-i.quantityDelta}` : String(-i.quantityDelta),
    }),
  }));
  const debtEffects =
    row.type === "SALE" && row.paymentMethod === "FIADO"
      ? [{ key: "fiado", text: interpolate(v.debtRemoved, { amount: formatCurrency(row.totalAmount) }) }]
      : row.debtPayments.map((dp) => ({
          key: `dp-${dp.id}`,
          text: interpolate(v.debtRestored, { amount: formatCurrency(dp.amount), owner: dp.ownerName }),
        }));
  const st = row.settlement;
  const effects = st
    ? [
        {
          key: "settlement",
          text: interpolate(v.settlementEffect, {
            owner: st.ownerName,
            kind: t.enums.settlement[st.type],
            amount: formatCurrency(row.totalAmount),
          }),
        },
      ]
    : [...stockEffects, ...debtEffects];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) return;
    startTransition(async () => {
      const result = st ? await voidSettlement({ id: row.id, reason }) : await voidTransaction({ id: row.id, reason });
      if (result.ok) {
        toast.success(interpolate(st ? v.settlementSuccess : v.success, { id: row.id }));
        onOpenChange(false);
      } else {
        const errors: Record<string, string> = t.transactions.errors;
        toast.error(errors[result.error] ?? errors.unknown);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="size-4 text-destructive" aria-hidden />
            {interpolate(st ? v.settlementTitle : v.title, { id: row.id })}
          </DialogTitle>
          <DialogDescription>{st ? v.settlementDescription : v.description}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
          <span className="flex items-center gap-1.5">
            <TypeBadge type={row.type} settlementType={st?.type} />
            <MethodBadge method={row.paymentMethod} />
          </span>
          <span className="font-semibold tabular-nums">{formatCurrency(row.totalAmount)}</span>
        </div>

        <div className="grid gap-1.5 rounded-lg bg-muted/60 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">{v.effects}</span>
          {effects.length === 0 ? (
            <p className="text-sm text-muted-foreground">{v.noEffects}</p>
          ) : (
            <ul className="grid gap-0.5 text-sm tabular-nums">
              {effects.map((e) => (
                <li key={e.key}>• {e.text}</li>
              ))}
            </ul>
          )}
        </div>

        <form id="void-form" onSubmit={handleSubmit}>
          <FormField label={v.reason} htmlFor="v-reason">
            <Input
              id="v-reason"
              value={reason}
              minLength={3}
              maxLength={200}
              placeholder={v.reasonPlaceholder}
              onChange={(e) => setReason(e.target.value)}
              required
              autoFocus
            />
          </FormField>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form="void-form" variant="destructive" disabled={pending || !valid}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Ban aria-hidden />}
            {pending ? v.confirming : st ? v.settlementConfirm : v.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
