"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ClipboardCheck,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useCallback, useDeferredValue, useMemo, useState } from "react";

import { AdminOnly } from "@/components/layout/admin-only";
import { EmptyState } from "@/components/shared/empty-state";
import { Pill, PillGroup } from "@/components/shared/filter-pills";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { interpolate, type Dictionary } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import {
  productPricing,
  stockStatus,
  type InventoryProduct,
  type OwnerOption,
  type StockStatus,
} from "@/lib/inventory/shared";
import { tryCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import { AdjustStockDialog } from "./adjust-stock-dialog";
import { MarginBadge, OwnerBadge, StockPill } from "./badges";
import { ProductFormDialog } from "./product-form-dialog";
import { RestockDialog } from "./restock-dialog";

type StatusFilter = "ALL" | StockStatus;
type DialogState =
  | { kind: "create" }
  | { kind: "edit" | "restock" | "adjust"; product: InventoryProduct }
  | null;
type OpenDialog = (kind: "edit" | "restock" | "adjust", product: InventoryProduct) => void;

/** Accent- and case-insensitive search key ("Mamá" matches "mama"). */
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function InventoryView({ products, owners }: { products: InventoryProduct[]; owners: OwnerOption[] }) {
  const { t } = useI18n();
  const [ownerFilter, setOwnerFilter] = useState<number | "ALL">("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [dialog, setDialog] = useState<DialogState>(null);

  const openDialog = useCallback<OpenDialog>((kind, product) => setDialog({ kind, product }), []);
  const closeDialog = useCallback((open: boolean) => !open && setDialog(null), []);

  const filtered = useMemo(() => {
    const q = fold(deferredSearch.trim());
    return products.filter((p) => {
      if (ownerFilter !== "ALL" && p.ownerId !== ownerFilter) return false;
      if (status !== "ALL" && (!p.isActive || stockStatus(p.currentStock, p.lowStockThreshold) !== status)) {
        return false;
      }
      return !q || fold(`${p.sku} ${p.name} ${p.category ?? ""}`).includes(q);
    });
  }, [products, ownerFilter, status, deferredSearch]);

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter((c): c is string => Boolean(c)))].sort(),
    [products],
  );

  const columns = useMemo(() => buildColumns(t, openDialog), [t, openDialog]);

  // TanStack Table manages its own memoization; the React Compiler is not enabled here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => String(row.id),
  });
  const rows = table.getRowModel().rows;

  const hasFilters = ownerFilter !== "ALL" || status !== "ALL" || search !== "";
  const clearFilters = () => {
    setOwnerFilter("ALL");
    setStatus("ALL");
    setSearch("");
  };
  const fl = t.inventory.filters;

  return (
    <div className="grid gap-4">
      {/* ── Toolbar ───────────────────────────────────────────── */}
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PillGroup label={fl.owner}>
            <Pill active={ownerFilter === "ALL"} onClick={() => setOwnerFilter("ALL")}>
              {fl.allOwners}
            </Pill>
            {owners.map((o) => (
              <Pill key={o.id} active={ownerFilter === o.id} onClick={() => setOwnerFilter(o.id)}>
                {o.name}
              </Pill>
            ))}
          </PillGroup>
          <AdminOnly>
            <Button onClick={() => setDialog({ kind: "create" })}>
              <Plus aria-hidden />
              {t.inventory.actions.addProduct}
            </Button>
          </AdminOnly>
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={fl.search}
              aria-label={fl.search}
              className="pl-8"
            />
          </div>
          <PillGroup label={fl.status} className="rounded-lg bg-muted p-0.5" segmented>
            {(
              [
                ["ALL", fl.statusAll],
                ["IN_STOCK", fl.statusInStock],
                ["LOW", fl.statusLow],
                ["AUDIT", fl.statusAudit],
              ] as const
            ).map(([value, label]) => (
              <Pill key={value} active={status === value} onClick={() => setStatus(value)} segmented>
                {label}
              </Pill>
            ))}
          </PillGroup>
        </div>

        <div className="flex min-h-6 items-center justify-between text-xs text-muted-foreground">
          <span aria-live="polite">{interpolate(fl.showing, { shown: filtered.length, total: products.length })}</span>
          {hasFilters && (
            <Button variant="ghost" size="xs" onClick={clearFilters}>
              <X aria-hidden />
              {fl.clear}
            </Button>
          )}
        </div>
      </div>

      {/* ── Results ───────────────────────────────────────────── */}
      {products.length === 0 ? (
        <EmptyState
          title={t.inventory.empty.noProducts}
          hint={t.inventory.empty.noProductsHint}
          action={
            <AdminOnly>
              <Button onClick={() => setDialog({ kind: "create" })}>
                <Plus aria-hidden />
                {t.inventory.actions.addProduct}
              </Button>
            </AdminOnly>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t.inventory.empty.noMatches}
          hint={t.inventory.empty.noMatchesHint}
          action={
            <Button variant="outline" onClick={clearFilters}>
              <X aria-hidden />
              {fl.clear}
            </Button>
          }
        />
      ) : (
        <>
          {/* Desktop / tablet: sortable table */}
          <Card className="hidden gap-0 py-0 md:flex">
            <Table>
              <TableHeader className="bg-muted/40">
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id} className="hover:bg-transparent">
                    {group.headers.map((header) => {
                      const sorted = header.column.getIsSorted();
                      const align = (header.column.columnDef.meta as ColumnMeta | undefined)?.align;
                      return (
                        <TableHead
                          key={header.id}
                          aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                          className={cn("h-10 px-3 text-xs", align === "right" && "text-right")}
                        >
                          {header.column.getCanSort() ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className={cn(
                                "inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                                align === "right" && "flex-row-reverse",
                              )}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {sorted === "asc" ? (
                                <ArrowUp className="size-3" aria-hidden />
                              ) : sorted === "desc" ? (
                                <ArrowDown className="size-3" aria-hidden />
                              ) : (
                                <ArrowUpDown className="size-3 opacity-40" aria-hidden />
                              )}
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className={cn(!row.original.isActive && "opacity-55")}>
                    {row.getVisibleCells().map((cell) => {
                      const align = (cell.column.columnDef.meta as ColumnMeta | undefined)?.align;
                      return (
                        <TableCell key={cell.id} className={cn("px-3 py-2.5", align === "right" && "text-right")}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Mobile: card list (same sorted/filtered rows) */}
          <ul className="grid gap-2 md:hidden">
            {rows.map(({ original: p }) => (
              <li key={p.id}>
                <ProductCard product={p} t={t} openDialog={openDialog} />
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ── Dialogs (mounted on open so each opens with fresh state) ── */}
      {dialog?.kind === "create" && (
        <ProductFormDialog open onOpenChange={closeDialog} owners={owners} categories={categories} />
      )}
      {dialog?.kind === "edit" && (
        <ProductFormDialog
          open
          onOpenChange={closeDialog}
          product={dialog.product}
          owners={owners}
          categories={categories}
        />
      )}
      {dialog?.kind === "restock" && <RestockDialog open onOpenChange={closeDialog} product={dialog.product} />}
      {dialog?.kind === "adjust" && <AdjustStockDialog open onOpenChange={closeDialog} product={dialog.product} />}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Columns
 * ──────────────────────────────────────────────────────────────────────────── */

type ColumnMeta = { align?: "right" };

function buildColumns(t: Dictionary, openDialog: OpenDialog): ColumnDef<InventoryProduct>[] {
  const c = t.inventory.columns;
  return [
    {
      accessorKey: "sku",
      header: c.sku,
      cell: ({ row }) => <span className="font-mono text-xs font-medium">{row.original.sku}</span>,
    },
    {
      accessorKey: "name",
      header: c.product,
      cell: ({ row }) => <ProductName product={row.original} t={t} />,
    },
    {
      id: "owner",
      accessorFn: (p) => p.ownerName,
      header: c.owner,
      cell: ({ row }) => <OwnerBadge ownerId={row.original.ownerId} name={row.original.ownerName} />,
    },
    {
      id: "pack",
      header: c.pack,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {interpolate(t.inventory.packInfo, {
            units: row.original.unitsPerPack,
            cost: formatCurrency(row.original.packCost),
          })}
        </span>
      ),
    },
    {
      id: "unitCost",
      accessorFn: (p) => tryCents(p.unitCost) ?? 0,
      header: c.unitCost,
      meta: { align: "right" } satisfies ColumnMeta,
      cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatCurrency(row.original.unitCost)}</span>,
    },
    {
      id: "pricing",
      accessorFn: (p) => productPricing(p).actualMargin ?? -Infinity,
      header: c.pricing,
      meta: { align: "right" } satisfies ColumnMeta,
      cell: ({ row }) => <Pricing product={row.original} />,
    },
    {
      id: "stock",
      accessorFn: (p) => p.currentStock,
      header: c.stock,
      meta: { align: "right" } satisfies ColumnMeta,
      cell: ({ row }) => <StockPill stock={row.original.currentStock} threshold={row.original.lowStockThreshold} />,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{c.actions}</span>,
      enableSorting: false,
      meta: { align: "right" } satisfies ColumnMeta,
      cell: ({ row }) => <RowActions product={row.original} t={t} openDialog={openDialog} />,
    },
  ];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Cells & pieces
 * ──────────────────────────────────────────────────────────────────────────── */

function ProductName({ product, t }: { product: InventoryProduct; t: Dictionary }) {
  return (
    <div className="grid min-w-36 gap-0.5">
      <span className="flex items-center gap-1.5 font-medium">
        {product.name}
        {!product.isActive && (
          <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground uppercase">
            {t.inventory.archived}
          </span>
        )}
      </span>
      {product.category && <span className="text-xs text-muted-foreground">{product.category}</span>}
    </div>
  );
}

function Pricing({ product }: { product: InventoryProduct }) {
  const p = productPricing(product);
  return (
    <div className="flex items-center justify-end gap-2 whitespace-nowrap tabular-nums">
      <span className="text-xs text-muted-foreground">{formatCurrency(p.suggestedCents / 100)}</span>
      <span className="text-muted-foreground" aria-hidden>
        →
      </span>
      <span className="font-medium">{formatCurrency(product.salePrice)}</span>
      <MarginBadge actual={p.actualMargin} target={p.targetMargin} />
    </div>
  );
}

function RowActions({
  product,
  t,
  openDialog,
  withLabels = false,
}: {
  product: InventoryProduct;
  t: Dictionary;
  openDialog: OpenDialog;
  withLabels?: boolean;
}) {
  const a = t.inventory.actions;
  const items = [
    { kind: "restock" as const, label: a.restock, icon: PackagePlus, className: "text-success" },
    {
      kind: "adjust" as const,
      label: a.adjust,
      icon: ClipboardCheck,
      // Highlight the reconciliation action where it is needed.
      className: product.currentStock <= 0 ? "text-destructive" : "text-info",
    },
    { kind: "edit" as const, label: a.edit, icon: Pencil, className: "" },
  ];
  return (
    <div className={cn("flex items-center gap-1", withLabels ? "flex-wrap" : "justify-end")}>
      {items.map(({ kind, label, icon: Icon, className }) => (
        <AdminOnly key={kind} label={withLabels ? undefined : label}>
          <Button
            variant={withLabels ? "outline" : "ghost"}
            size={withLabels ? "sm" : "icon-sm"}
            aria-label={`${label}: ${product.name}`}
            onClick={() => openDialog(kind, product)}
            disabled={!product.isActive && kind !== "edit"}
            className={cn(className)}
          >
            <Icon aria-hidden />
            {withLabels && <span className="text-foreground">{label}</span>}
          </Button>
        </AdminOnly>
      ))}
    </div>
  );
}

function ProductCard({ product: p, t, openDialog }: { product: InventoryProduct; t: Dictionary; openDialog: OpenDialog }) {
  return (
    <Card size="sm" className={cn("gap-3 px-3", !p.isActive && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <ProductName product={p} t={t} />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
            <OwnerBadge ownerId={p.ownerId} name={p.ownerName} />
          </div>
        </div>
        <StockPill stock={p.currentStock} threshold={p.lowStockThreshold} />
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t.inventory.columns.pack}</dt>
        <dd className="text-right tabular-nums">
          {interpolate(t.inventory.packInfo, { units: p.unitsPerPack, cost: formatCurrency(p.packCost) })}
        </dd>
        <dt className="text-muted-foreground">{t.inventory.columns.unitCost}</dt>
        <dd className="text-right tabular-nums">{formatCurrency(p.unitCost)}</dd>
        <dt className="text-muted-foreground">{t.inventory.columns.pricing}</dt>
        <dd className="flex justify-end">
          <Pricing product={p} />
        </dd>
      </dl>
      <RowActions product={p} t={t} openDialog={openDialog} withLabels />
    </Card>
  );
}
