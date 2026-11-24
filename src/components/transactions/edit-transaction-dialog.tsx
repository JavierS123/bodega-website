"use client";

import { Loader2, Pencil } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { updateTransaction } from "@/actions/transactions";
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
import type { PaymentMethod } from "@/db/schema";
import { formatCurrency } from "@/lib/format";
import { interpolate } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import { MONEY_METHODS, SALE_METHODS, type ClientOption, type LedgerRow } from "@/lib/transactions/shared";

import { TypeBadge } from "./badges";

export function EditTransactionDialog({
  open,
  onOpenChange,
  row,
  clients,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: LedgerRow;
  clients: ClientOption[];
}) {
  const { t } = useI18n();
  const e = t.transactions.edit;
  const s = t.transactions.sale;
  const [pending, startTransition] = useTransition();

  const [notes, setNotes] = useState(row.notes ?? "");
  const [method, setMethod] = useState<PaymentMethod>(row.paymentMethod);
  const [clientId, setClientId] = useState<number | null>(row.clientId);

  const methods: readonly PaymentMethod[] =
    row.type === "SALE" ? SALE_METHODS : row.type === "DEBT_PAYMENT" ? MONEY_METHODS : [];
  const clientEditable = row.type === "SALE";
  const clientMissing = method === "FIADO" && !clientId;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (clientMissing) return;
    startTransition(async () => {
      const result = await updateTransaction({ id: row.id, notes, paymentMethod: method, clientId });
      if (result.ok) {
        toast.success(e.success, { description: `#${row.id}` });
        onOpenChange(false);
      } else {
        toast.error(t.transactions.errors[result.error]);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-4" aria-hidden />
            {interpolate(e.title, { id: row.id })}
          </DialogTitle>
          <DialogDescription>{e.description}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
          <TypeBadge type={row.type} settlementType={row.settlement?.type} />
          <span className="font-semibold tabular-nums">{formatCurrency(row.totalAmount)}</span>
        </div>

        <form id="edit-tx-form" onSubmit={handleSubmit} className="grid gap-4">
          {methods.length > 0 ? (
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">{s.method}</span>
              <PillGroup label={s.method} className="justify-self-start rounded-lg bg-muted p-0.5" segmented>
                {methods.map((m) => (
                  <Pill key={m} active={method === m} onClick={() => setMethod(m)} segmented>
                    {t.enums.method[m]}
                  </Pill>
                ))}
              </PillGroup>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{e.notesOnly}</p>
          )}

          {clientEditable ? (
            <FormField
              label={s.client}
              htmlFor="e-client"
              invalid={clientMissing}
              hint={method === "FIADO" ? s.clientRequired : t.common.optional}
            >
              <OptionSelect
                id="e-client"
                value={clientId}
                onChange={setClientId}
                options={clients.map((c) => ({ value: c.id, label: c.name }))}
                placeholder={s.clientPlaceholder}
                allLabel={method === "FIADO" ? undefined : "—"}
                invalid={clientMissing}
              />
            </FormField>
          ) : (
            row.clientName && (
              <p className="text-sm">
                <span className="text-muted-foreground">{s.client}: </span>
                {row.clientName}
              </p>
            )
          )}

          <FormField label={s.notes} htmlFor="e-notes">
            <Input
              id="e-notes"
              value={notes}
              maxLength={500}
              placeholder={s.notesPlaceholder}
              onChange={(ev) => setNotes(ev.target.value)}
              autoFocus={methods.length === 0}
            />
          </FormField>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form="edit-tx-form" disabled={pending || clientMissing}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Pencil aria-hidden />}
            {pending ? e.submitting : e.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
