"use client";

import { HandCoins, Loader2 } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { registerDebtPayment } from "@/actions/clients";
import { Pill, PillGroup } from "@/components/shared/filter-pills";
import { FormField, PreviewStat } from "@/components/shared/form-field";
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
import type { ClientDebtSummary } from "@/lib/clients/shared";
import { formatCurrency } from "@/lib/format";
import { interpolate } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import type { OwnerOption } from "@/lib/inventory/shared";
import { centsToDecimal, toCents, tryCents } from "@/lib/money";
import { localInputToIso, MONEY_METHODS, type MoneyMethod } from "@/lib/transactions/shared";

import { AbonoPreview } from "./abono-preview";

export function DebtPaymentDialog({
  open,
  onOpenChange,
  clients,
  owners,
  initialClientId,
  initialOwnerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: ClientDebtSummary[];
  owners: OwnerOption[];
  initialClientId: number | null;
  initialOwnerId?: number;
}) {
  const { t } = useI18n();
  const a = t.clients.abono;
  const [pending, startTransition] = useTransition();

  /** Owners this client currently owes (positive balance only). */
  const owedTo = (c: ClientDebtSummary | undefined) => (c ? c.owners.filter((o) => toCents(o.balance) > 0) : []);
  const debtors = clients.filter((c) => owedTo(c).length > 0);

  const [clientId, setClientId] = useState<number | null>(initialClientId);
  const client = clients.find((c) => c.id === clientId);
  const [ownerId, setOwnerId] = useState<number | null>(() => {
    const list = owedTo(clients.find((c) => c.id === initialClientId));
    if (initialOwnerId && list.some((o) => o.ownerId === initialOwnerId)) return initialOwnerId;
    return list.length === 1 ? list[0].ownerId : null;
  });
  const owed = owedTo(client);
  const debt = owed.find((o) => o.ownerId === ownerId);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<MoneyMethod>("PAGO_MOVIL");
  const [notes, setNotes] = useState("");
  const [occurredAt, setOccurredAt] = useState("");

  const debtCents = debt ? toCents(debt.balance) : 0;
  const amountCents = tryCents(amount);
  const exceeds = amountCents !== null && amountCents > debtCents;
  const valid = Boolean(client && debt) && amountCents !== null && amountCents > 0 && !exceeds;

  function selectClient(id: number | null) {
    setClientId(id);
    const list = owedTo(clients.find((c) => c.id === id));
    setOwnerId(list.length === 1 ? list[0].ownerId : null);
    setAmount("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || !client || !debt) return;
    startTransition(async () => {
      const result = await registerDebtPayment({
        clientId: client.id,
        ownerId: debt.ownerId,
        amount: amount.trim(),
        paymentMethod: method,
        notes,
        occurredAt: localInputToIso(occurredAt),
      });
      if (result.ok) {
        toast.success(interpolate(a.success, { amount: formatCurrency(amount), client: client.name }), {
          description: interpolate(a.settledUnits, { units: result.data.unitsSettled }),
        });
        onOpenChange(false);
      } else {
        toast.error(t.clients.errors[result.error]);
      }
    });
  }

  const ownerName = (id: number) => owners.find((o) => o.id === id)?.name ?? "";

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="size-4 text-success" aria-hidden />
            {a.title}
          </DialogTitle>
          <DialogDescription>{a.description}</DialogDescription>
        </DialogHeader>

        {debtors.length === 0 ? (
          <p className="rounded-lg bg-muted/60 px-3 py-4 text-center text-sm text-muted-foreground">{a.noDebt}</p>
        ) : (
          <form id="abono-form" onSubmit={handleSubmit} className="grid gap-4">
            <FormField label={a.client} htmlFor="a-client">
              <OptionSelect
                id="a-client"
                value={clientId}
                onChange={selectClient}
                placeholder={a.clientPlaceholder}
                options={debtors.map((c) => ({ value: c.id, label: `${c.name} — ${formatCurrency(c.totalPending)}` }))}
              />
            </FormField>

            {client && owed.length === 0 && <p className="text-sm text-muted-foreground">{a.noDebt}</p>}

            {owed.length > 0 && (
              <FormField label={a.owner} htmlFor="a-owner">
                <OptionSelect
                  id="a-owner"
                  value={ownerId}
                  onChange={(v) => {
                    setOwnerId(v);
                    setAmount("");
                  }}
                  placeholder={a.ownerPlaceholder}
                  options={owed.map((o) => ({
                    value: o.ownerId,
                    label: `${o.ownerName} — ${interpolate(a.owes, { amount: formatCurrency(o.balance) })}`,
                  }))}
                />
              </FormField>
            )}

            {debt && (
              <>
                <FormField label={a.amount} htmlFor="a-amount" invalid={exceeds}>
                  <div className="flex gap-2">
                    <Input
                      id="a-amount"
                      type="number"
                      inputMode="decimal"
                      min={0.01}
                      step="0.01"
                      max={centsToDecimal(debtCents)}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      aria-invalid={exceeds || undefined}
                      required
                      autoFocus
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => setAmount(centsToDecimal(debtCents))}
                    >
                      {interpolate(a.payAll, { amount: formatCurrency(debt.balance) })}
                    </Button>
                  </div>
                </FormField>
                {exceeds && <p className="-mt-2 text-xs text-destructive">{t.clients.errors.exceedsDebt}</p>}

                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">{a.method}</span>
                  <PillGroup label={a.method} className="justify-self-start rounded-lg bg-muted p-0.5" segmented>
                    {MONEY_METHODS.map((m) => (
                      <Pill key={m} active={method === m} onClick={() => setMethod(m)} segmented>
                        {t.enums.method[m]}
                      </Pill>
                    ))}
                  </PillGroup>
                </div>

                <div className="grid grid-cols-2 gap-2" aria-live="polite">
                  <PreviewStat
                    label={interpolate(a.currentDebt, { owner: ownerName(debt.ownerId) })}
                    value={formatCurrency(debt.balance)}
                    tone="negative"
                  />
                  <PreviewStat
                    label={a.remaining}
                    value={
                      amountCents === null || exceeds ? "—" : formatCurrency((debtCents - amountCents) / 100)
                    }
                    tone={amountCents !== null && amountCents === debtCents ? "positive" : "default"}
                  />
                </div>
                {!exceeds && <AbonoPreview units={debt.units} amountCents={amountCents} />}

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label={a.occurredAt} htmlFor="a-date" hint={t.transactions.sale.occurredAtHint}>
                    <Input
                      id="a-date"
                      type="datetime-local"
                      value={occurredAt}
                      onChange={(e) => setOccurredAt(e.target.value)}
                    />
                  </FormField>
                  <FormField label={a.notes} htmlFor="a-notes" hint={t.common.optional}>
                    <Input id="a-notes" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} />
                  </FormField>
                </div>
              </>
            )}
          </form>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form="abono-form" disabled={pending || !valid}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <HandCoins aria-hidden />}
            {pending ? a.submitting : a.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
