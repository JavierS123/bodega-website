"use client";

import { Loader2, UserPen, UserPlus } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { saveClient } from "@/actions/clients";
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
import type { ClientDebtSummary } from "@/lib/clients/shared";
import { useI18n } from "@/lib/i18n/provider";

export function ClientFormDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present → edit mode. */
  client?: Pick<ClientDebtSummary, "id" | "name" | "phone" | "notes">;
}) {
  const { t } = useI18n();
  const f = t.clients.form;
  const isEdit = Boolean(client);
  const [pending, startTransition] = useTransition();
  const [invalid, setInvalid] = useState<Set<string>>(new Set());

  const [name, setName] = useState(client?.name ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [notes, setNotes] = useState(client?.notes ?? "");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveClient({ id: client?.id, name, phone, notes });
      if (result.ok) {
        toast.success(isEdit ? f.updated : f.created, { description: name.trim() });
        onOpenChange(false);
      } else {
        setInvalid(new Set(Object.keys(result.fieldErrors ?? {})));
        if (result.error === "duplicateName") setInvalid(new Set(["name"]));
        toast.error(t.clients.errors[result.error]);
      }
    });
  }

  const Icon = isEdit ? UserPen : UserPlus;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-4" aria-hidden />
            {isEdit ? f.editTitle : f.addTitle}
          </DialogTitle>
          <DialogDescription>{f.description}</DialogDescription>
        </DialogHeader>

        <form id="client-form" onSubmit={handleSubmit} className="grid gap-4">
          <FormField label={f.name} htmlFor="c-name" invalid={invalid.has("name")}>
            <Input
              id="c-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              maxLength={80}
              required
              autoFocus
              aria-invalid={invalid.has("name") || undefined}
            />
          </FormField>
          <FormField label={f.phone} htmlFor="c-phone" invalid={invalid.has("phone")} hint={t.common.optional}>
            <Input
              id="c-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={30}
              aria-invalid={invalid.has("phone") || undefined}
            />
          </FormField>
          <FormField label={f.notes} htmlFor="c-notes" hint={t.common.optional}>
            <Input id="c-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
          </FormField>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form="client-form" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Icon aria-hidden />}
            {pending ? f.submitting : f.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
