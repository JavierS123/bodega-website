"use client";

import { AlertTriangle, ArrowLeftRight, Loader2 } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { recordSettlement } from "@/actions/owners";
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
import type { OwnerSettlementType } from "@/db/schema";
import { formatCurrency } from "@/lib/format";
import { interpolate } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import { toCents, tryCents } from "@/lib/money";
import { SETTLEMENT_METHODS, SETTLEMENT_TYPES, type OwnerSummary } from "@/lib/owners/shared";
import { localInputToIso, type MoneyMethod } from "@/lib/transactions/shared";

export function SettlementDialog({
  open,
  onOpenChange,
  summaries,
  initialOwnerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summaries: OwnerSummary[];
  initialOwnerId: number | null;
}) {
  const { t } = useI18n();
  const f = t.owners.form;
  const [pending, startTransition] = useTransition();

  const [ownerId, setOwnerId] = useState<number | null>(initialOwnerId);
  const [type, setType] = useState<OwnerSettlementType>("PAYOUT_TRANSFER");
  const [method, setMethod] = useState<MoneyMethod>(SETTLEMENT_METHODS.PAYOUT_TRANSFER[0]);
  const [amount, setAmount] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [notes, setNotes] = useState("");

  const owner = summaries.find((s) => s.ownerId === ownerId);
  const methods = SETTLEMENT_METHODS[type];
  const amountCents = tryCents(amount);
  const valid = Boolean(owner) && amountCents !== null && amountCents > 0 && methods.includes(method);

  // Soft warning only: real-world balances can drift (e.g. a missed record), so don't block.
  const available =
    owner && type === "PAYOUT_TRANSFER"
      ? owner.porTransferir
      : owner && type === "CASH_DEPOSIT"
        ? owner.cashOnHand
        : null;
  const exceeds = available !== null && amountCents !== null && amountCents > toCents(available);

  function selectType(next: OwnerSettlementType) {
    setType(next);
    if (!SETTLEMENT_METHODS[next].includes(method)) setMethod(SETTLEMENT_METHODS[next][0]);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || !owner) return;
    startTransition(async () => {
      const result = await recordSettlement({
        ownerId: owner.ownerId,
        type,
        amount: amount.trim(),
        paymentMethod: method,
        occurredAt: localInputToIso(occurredAt),
        notes,
      });
      if (result.ok) {
        toast.success(
          interpolate(f.success, {
            type: t.enums.settlement[type],
            amount: formatCurrency(amount),
            owner: owner.ownerName,
          }),
        );
        onOpenChange(false);
      } else {
        toast.error(t.owners.errors[result.error]);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="size-4" aria-hidden />
            {f.title}
          </DialogTitle>
          <DialogDescription>{f.description}</DialogDescription>
        </DialogHeader>

        <form id="settlement-form" onSubmit={handleSubmit} className="grid gap-4">
          <FormField
            label={f.owner}
            htmlFor="st-owner"
            hint={
              owner
                ? interpolate(f.available, {
                    bank: formatCurrency(owner.porTransferir),
                    cash: formatCurrency(owner.cashOnHand),
                  })
                : undefined
            }
          >
            <OptionSelect
              id="st-owner"
              value={ownerId}
              onChange={setOwnerId}
              placeholder={f.ownerPlaceholder}
              options={summaries.map((s) => ({ value: s.ownerId, label: s.ownerName }))}
            />
          </FormField>

          <FormField label={f.type} htmlFor="st-type" hint={t.enums.settlementHint[type]}>
            <OptionSelect
              id="st-type"
              value={type}
              onChange={(v) => v && selectType(v)}
              options={SETTLEMENT_TYPES.map((v) => ({ value: v, label: t.enums.settlement[v] }))}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={f.amount} htmlFor="st-amount">
              <Input
                id="st-amount"
                type="number"
                inputMode="decimal"
                min={0.01}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </FormField>
            <div className="grid content-start gap-1.5">
              <span className="text-sm font-medium">{f.method}</span>
              <PillGroup label={f.method} className="justify-self-start rounded-lg bg-muted p-0.5" segmented>
                {methods.map((m) => (
                  <Pill key={m} active={method === m} onClick={() => setMethod(m)} segmented>
                    {t.enums.method[m]}
                  </Pill>
                ))}
              </PillGroup>
            </div>
          </div>

          {exceeds && available !== null && (
            <p className="-mt-2 flex items-center gap-1 text-xs text-warning">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              {interpolate(f.exceedsWarning, { amount: formatCurrency(available) })}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={f.occurredAt} htmlFor="st-date" hint={t.transactions.sale.occurredAtHint}>
              <Input
                id="st-date"
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </FormField>
            <FormField label={f.notes} htmlFor="st-notes" hint={t.common.optional}>
              <Input id="st-notes" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form="settlement-form" disabled={pending || !valid}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowLeftRight aria-hidden />}
            {pending ? f.submitting : f.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
