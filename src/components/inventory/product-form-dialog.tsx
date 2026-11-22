"use client";

import { Archive, ArchiveRestore, Loader2, Wand2 } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { saveProduct, setProductActive, type ProductInput } from "@/actions/inventory";
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
import { formatCurrency, formatPercent } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import {
  actualMarginPct,
  suggestedPriceCents,
  unitCostCents,
  type InventoryProduct,
  type OwnerOption,
} from "@/lib/inventory/shared";
import { centsToDecimal, tryCents } from "@/lib/money";

import { FormField, PreviewStat } from "./form-field";

type FieldName = keyof ProductInput;

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  owners,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present → edit mode. */
  product?: InventoryProduct;
  owners: OwnerOption[];
  categories: string[];
}) {
  const { t } = useI18n();
  const f = t.inventory.form;
  const isEdit = Boolean(product);
  const [pending, startTransition] = useTransition();
  const [invalid, setInvalid] = useState<Set<FieldName>>(new Set());

  const [sku, setSku] = useState(product?.sku ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [aliases, setAliases] = useState(product?.aliases.join(", ") ?? "");
  const [ownerId, setOwnerId] = useState(product ? String(product.ownerId) : "");
  const [unitsPerPack, setUnitsPerPack] = useState(String(product?.unitsPerPack ?? 1));
  const [packCost, setPackCost] = useState(product?.packCost ?? "");
  const [marginPct, setMarginPct] = useState(product ? String(Number(product.marginPct)) : "30");
  const [salePrice, setSalePrice] = useState(product?.salePrice ?? "");
  const [threshold, setThreshold] = useState(String(product?.lowStockThreshold ?? 5));
  const [initialStock, setInitialStock] = useState("0");

  // Live calculations (integer cents) — the server recomputes everything on save.
  const upp = Number.parseInt(unitsPerPack, 10);
  const packCents = tryCents(packCost);
  const margin = Number.parseFloat(marginPct);
  const unitCents = packCents !== null && upp > 0 ? unitCostCents(packCents, upp) : null;
  const suggestedCents =
    unitCents !== null && Number.isFinite(margin) ? suggestedPriceCents(unitCents, margin) : null;
  const saleCents = tryCents(salePrice);
  const actual = unitCents !== null && saleCents !== null ? actualMarginPct(saleCents, unitCents) : null;

  const fieldProps = (field: FieldName) => ({
    "aria-invalid": invalid.has(field) || undefined,
    onInput: () =>
      setInvalid((prev) => {
        if (!prev.has(field)) return prev;
        const next = new Set(prev);
        next.delete(field);
        return next;
      }),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: ProductInput = {
      id: product?.id,
      sku,
      name,
      category,
      aliases: aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
      ownerId: Number(ownerId),
      unitsPerPack: upp,
      packCost: packCost.trim(),
      marginPct: margin,
      salePrice: salePrice.trim(),
      lowStockThreshold: Number.parseInt(threshold, 10),
      initialStock: isEdit ? undefined : Number.parseInt(initialStock || "0", 10),
    };

    startTransition(async () => {
      const result = await saveProduct(input);
      if (result.ok) {
        toast.success(isEdit ? f.updated : f.created, { description: `${input.sku.toUpperCase()} · ${input.name}` });
        onOpenChange(false);
        return;
      }
      setInvalid(new Set(Object.keys(result.fieldErrors ?? {}) as FieldName[]));
      if (result.error === "duplicateSku") setInvalid(new Set(["sku"]));
      toast.error(t.inventory.errors[result.error]);
    });
  }

  function handleArchiveToggle() {
    if (!product) return;
    const active = !product.isActive;
    startTransition(async () => {
      const result = await setProductActive({ id: product.id, active });
      if (result.ok) {
        toast.success(active ? f.restoredToast : f.archivedToast, { description: product.sku });
        onOpenChange(false);
      } else {
        toast.error(t.inventory.errors[result.error]);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? f.editTitle : f.addTitle}</DialogTitle>
          <DialogDescription>{f.description}</DialogDescription>
        </DialogHeader>

        <form id="product-form" onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <FormField label={f.sku} htmlFor="p-sku" hint={f.skuHint} invalid={invalid.has("sku")}>
              <Input
                id="p-sku"
                value={sku}
                onChange={(e) => setSku(e.target.value.toUpperCase().replace(/\s+/g, "_"))}
                required
                maxLength={32}
                pattern="[A-Z0-9_]{2,32}"
                autoCapitalize="characters"
                className="font-mono"
                {...fieldProps("sku")}
              />
            </FormField>
            <FormField label={f.name} htmlFor="p-name" invalid={invalid.has("name")}>
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} {...fieldProps("name")} />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={f.owner} htmlFor="p-owner" invalid={invalid.has("ownerId")}>
              <Select value={ownerId} onValueChange={setOwnerId} required>
                <SelectTrigger id="p-owner" className="w-full" aria-invalid={invalid.has("ownerId") || undefined}>
                  <SelectValue placeholder={f.ownerPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {owners.map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label={f.category} htmlFor="p-category" invalid={invalid.has("category")}>
              <Input
                id="p-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={f.categoryPlaceholder}
                list="p-category-options"
                maxLength={60}
                {...fieldProps("category")}
              />
              <datalist id="p-category-options">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </FormField>
          </div>

          <FormField label={f.aliases} htmlFor="p-aliases" invalid={invalid.has("aliases")} hint={f.aliasesHint}>
            <Input
              id="p-aliases"
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder={f.aliasesPlaceholder}
              maxLength={400}
              {...fieldProps("aliases")}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <FormField label={f.unitsPerPack} htmlFor="p-upp" invalid={invalid.has("unitsPerPack")}>
              <Input
                id="p-upp"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={unitsPerPack}
                onChange={(e) => setUnitsPerPack(e.target.value)}
                required
                {...fieldProps("unitsPerPack")}
              />
            </FormField>
            <FormField label={f.packCost} htmlFor="p-packcost" invalid={invalid.has("packCost")}>
              <Input
                id="p-packcost"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={packCost}
                onChange={(e) => setPackCost(e.target.value)}
                required
                {...fieldProps("packCost")}
              />
            </FormField>
            <FormField label={f.marginPct} htmlFor="p-margin" invalid={invalid.has("marginPct")} className="col-span-2 sm:col-span-1">
              <Input
                id="p-margin"
                type="number"
                inputMode="decimal"
                min={0}
                max={999.99}
                step="0.01"
                value={marginPct}
                onChange={(e) => setMarginPct(e.target.value)}
                required
                {...fieldProps("marginPct")}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-3 gap-2" aria-live="polite">
            <PreviewStat label={f.unitCost} value={unitCents === null ? "—" : formatCurrency(unitCents / 100)} />
            <PreviewStat label={f.suggestedPrice} value={suggestedCents === null ? "—" : formatCurrency(suggestedCents / 100)} />
            <PreviewStat
              label={f.actualMargin}
              value={actual === null ? "—" : formatPercent(actual, 1)}
              tone={actual === null ? "muted" : actual < 0 ? "negative" : actual + 0.005 < margin ? "default" : "positive"}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={f.salePrice} htmlFor="p-sale" invalid={invalid.has("salePrice")}>
              <div className="flex gap-2">
                <Input
                  id="p-sale"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                  required
                  {...fieldProps("salePrice")}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={suggestedCents === null}
                  onClick={() => suggestedCents !== null && setSalePrice(centsToDecimal(suggestedCents))}
                  title={f.useSuggested}
                >
                  <Wand2 aria-hidden />
                  <span className="hidden sm:inline">{f.useSuggested}</span>
                </Button>
              </div>
            </FormField>
            <FormField label={f.lowStockThreshold} htmlFor="p-threshold" invalid={invalid.has("lowStockThreshold")}>
              <Input
                id="p-threshold"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                required
                {...fieldProps("lowStockThreshold")}
              />
            </FormField>
          </div>

          {!isEdit && (
            <FormField label={f.initialStock} htmlFor="p-initial" hint={f.initialStockHint} invalid={invalid.has("initialStock")}>
              <Input
                id="p-initial"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={initialStock}
                onChange={(e) => setInitialStock(e.target.value)}
                {...fieldProps("initialStock")}
              />
            </FormField>
          )}
        </form>

        <DialogFooter className="sm:justify-between">
          {isEdit && product ? (
            <Button
              type="button"
              variant={product.isActive ? "destructive" : "outline"}
              onClick={handleArchiveToggle}
              disabled={pending}
              title={f.archiveHint}
            >
              {product.isActive ? <Archive aria-hidden /> : <ArchiveRestore aria-hidden />}
              {product.isActive ? f.archive : f.restore}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              {f.cancel}
            </Button>
            <Button type="submit" form="product-form" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {pending ? f.saving : f.save}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
