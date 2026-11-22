"use client";

import { Loader2, PackagePlus } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { restockProduct } from "@/actions/inventory";
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
import { formatCurrency, formatPercent } from "@/lib/format";
import { interpolate } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import { suggestedPriceCents, unitCostCents, type InventoryProduct } from "@/lib/inventory/shared";
import { centsToDecimal, tryCents } from "@/lib/money";

import { OwnerBadge } from "./badges";
import { FormField, PreviewStat } from "./form-field";

export function RestockDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: InventoryProduct;
}) {
  const { t } = useI18n();
  const r = t.inventory.restock;
  const [pending, startTransition] = useTransition();

  const [packs, setPacks] = useState("1");
  const [packCost, setPackCost] = useState(product.packCost);
  const [updatePrice, setUpdatePrice] = useState(false);

  const margin = Number(product.marginPct) || 0;
  const packCount = Number.parseInt(packs, 10);
  const packCents = tryCents(packCost);
  const valid = packCount >= 1 && packCents !== null && packCents >= 0;

  const unitsAdded = valid ? packCount * product.unitsPerPack : 0;
  const newUnitCents = packCents !== null ? unitCostCents(packCents, product.unitsPerPack) : null;
  const totalCents = valid ? packCount * packCents : null;
  const suggested = newUnitCents !== null ? suggestedPriceCents(newUnitCents, margin) : null;

  const [newSalePrice, setNewSalePrice] = useState(() =>
    centsToDecimal(suggestedPriceCents(unitCostCents(tryCents(product.packCost) ?? 0, product.unitsPerPack), margin)),
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) return;
    startTransition(async () => {
      const result = await restockProduct({
        productId: product.id,
        packs: packCount,
        packCost: packCost.trim(),
        newSalePrice: updatePrice ? newSalePrice.trim() : null,
      });
      if (result.ok) {
        toast.success(interpolate(r.success, { units: result.data.unitsAdded, product: product.name }), {
          description: `${product.sku} → ${result.data.newStock} u`,
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
            <PackagePlus className="size-4 text-emerald-600" aria-hidden />
            {r.title}
          </DialogTitle>
          <DialogDescription>{interpolate(r.description, { owner: product.ownerName })}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
          <div className="grid min-w-0">
            <span className="truncate font-medium">{product.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {product.sku} · {product.unitsPerPack} u / pack
            </span>
          </div>
          <OwnerBadge ownerId={product.ownerId} name={product.ownerName} />
        </div>

        <form id="restock-form" onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label={r.packs} htmlFor="r-packs">
              <Input
                id="r-packs"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={packs}
                onChange={(e) => setPacks(e.target.value)}
                required
                autoFocus
              />
            </FormField>
            <FormField
              label={r.packCost}
              htmlFor="r-packcost"
              hint={interpolate(r.packCostHint, { cost: formatCurrency(product.packCost) })}
            >
              <Input
                id="r-packcost"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={packCost}
                onChange={(e) => setPackCost(e.target.value)}
                required
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-2" aria-live="polite">
            <PreviewStat label={r.unitsAdded} value={valid ? `+${unitsAdded} u` : "—"} tone="positive" />
            <PreviewStat label={r.newStock} value={valid ? `${product.currentStock + unitsAdded} u` : "—"} />
            <PreviewStat label={r.newUnitCost} value={newUnitCents === null ? "—" : formatCurrency(newUnitCents / 100)} />
            <PreviewStat label={r.totalCost} value={totalCents === null ? "—" : formatCurrency(totalCents / 100)} />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={updatePrice}
              onChange={(e) => setUpdatePrice(e.target.checked)}
              className="size-4 accent-primary"
            />
            {r.updatePrice}
          </label>

          {updatePrice && (
            <FormField
              label={r.newSalePrice}
              htmlFor="r-saleprice"
              hint={
                suggested === null
                  ? undefined
                  : interpolate(r.suggestedAt, { margin: formatPercent(margin, 0), price: formatCurrency(suggested / 100) })
              }
            >
              <Input
                id="r-saleprice"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={newSalePrice}
                onChange={(e) => setNewSalePrice(e.target.value)}
                required
              />
            </FormField>
          )}
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t.inventory.form.cancel}
          </Button>
          <Button type="submit" form="restock-form" disabled={pending || !valid}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <PackagePlus aria-hidden />}
            {pending ? r.submitting : r.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
