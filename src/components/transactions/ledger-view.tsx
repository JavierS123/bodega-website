"use client";

import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { Ban, ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus, ReceiptText, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useMemo, useOptimistic, useState, useTransition } from "react";

import { OwnerBadge } from "@/components/inventory/badges";
import { AdminOnly } from "@/components/layout/admin-only";
import { EmptyState } from "@/components/shared/empty-state";
import { OptionSelect } from "@/components/shared/option-select";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { interpolate, type Dictionary } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import type { OwnerOption } from "@/lib/inventory/shared";
import { toCents } from "@/lib/money";
import {
  EMPTY_LEDGER_FILTERS,
  hasActiveLedgerFilters,
  LEDGER_PAGE_SIZE,
  ledgerFiltersToSearch,
  PAYMENT_METHODS,
  TRANSACTION_SOURCES,
  TRANSACTION_TYPES,
  type ClientOption,
  type LedgerFilters,
  type LedgerPage,
  type LedgerRow,
  type SaleProductOption,
} from "@/lib/transactions/shared";
import { cn } from "@/lib/utils";

import { MethodBadge, SourceLabel, TypeBadge, VoidedBadge } from "./badges";
import { EditTransactionDialog } from "./edit-transaction-dialog";
import { ManualSaleDialog } from "./manual-sale-dialog";
import { VoidTransactionDialog } from "./void-transaction-dialog";

type DialogState = { kind: "sale" } | { kind: "edit" | "void"; row: LedgerRow } | null;
type OpenDialog = (kind: "edit" | "void", row: LedgerRow) => void;
type ColumnMeta = { align?: "right"; className?: string };

export function LedgerView({
  data,
  filters,
  owners,
  clients,
  products,
}: {
  data: LedgerPage;
  filters: LedgerFilters;
  owners: OwnerOption[];
  clients: ClientOption[];
  products: SaleProductOption[];
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Controls reflect the new filters instantly while the server re-renders the page.
  const [optimistic, setOptimistic] = useOptimistic(filters);
  const [dialog, setDialog] = useState<DialogState>(null);

  const navigate = useCallback(
    (next: LedgerFilters) =>
      startTransition(() => {
        setOptimistic(next);
        router.push(`/transactions${ledgerFiltersToSearch(next)}`, { scroll: false });
      }),
    [router, setOptimistic],
  );
  /** Any filter change goes back to page 1. */
  const setFilter = <K extends keyof LedgerFilters>(key: K, value: LedgerFilters[K]) =>
    navigate({ ...optimistic, [key]: value, page: 1 });

  const openDialog = useCallback<OpenDialog>((kind, row) => setDialog({ kind, row }), []);
  const closeDialog = useCallback((open: boolean) => !open && setDialog(null), []);

  const columns = useMemo(() => buildColumns(t, locale, openDialog), [t, locale, openDialog]);

  // TanStack Table manages its own memoization; the React Compiler is not enabled here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: data.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
    getRowId: (row) => String(row.id),
    manualPagination: true,
    pageCount: data.pageCount,
  });
  const rows = table.getRowModel().rows;

  const fl = t.transactions.filters;
  const filtered = hasActiveLedgerFilters(optimistic);
  const firstRow = data.total === 0 ? 0 : (data.page - 1) * LEDGER_PAGE_SIZE + 1;
  const lastRow = Math.min(data.page * LEDGER_PAGE_SIZE, data.total);

  return (
    <div className="grid gap-4">
      {/* ── Toolbar ───────────────────────────────────────────── */}
      <Card size="sm" className="gap-3 px-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <FilterField label={fl.from} htmlFor="f-from">
            <Input
              id="f-from"
              type="date"
              value={optimistic.from ?? ""}
              max={optimistic.to ?? undefined}
              onChange={(e) => setFilter("from", e.target.value || null)}
            />
          </FilterField>
          <FilterField label={fl.to} htmlFor="f-to">
            <Input
              id="f-to"
              type="date"
              value={optimistic.to ?? ""}
              min={optimistic.from ?? undefined}
              onChange={(e) => setFilter("to", e.target.value || null)}
            />
          </FilterField>
          <FilterField label={fl.type} htmlFor="f-type">
            <OptionSelect
              id="f-type"
              value={optimistic.type}
              onChange={(v) => setFilter("type", v)}
              allLabel={fl.all}
              options={TRANSACTION_TYPES.map((v) => ({ value: v, label: t.enums.type[v] }))}
            />
          </FilterField>
          <FilterField label={fl.method} htmlFor="f-method">
            <OptionSelect
              id="f-method"
              value={optimistic.method}
              onChange={(v) => setFilter("method", v)}
              allLabel={fl.all}
              options={PAYMENT_METHODS.filter((m) => m !== "NONE").map((v) => ({ value: v, label: t.enums.method[v] }))}
            />
          </FilterField>
          <FilterField label={fl.owner} htmlFor="f-owner">
            <OptionSelect
              id="f-owner"
              value={optimistic.ownerId}
              onChange={(v) => setFilter("ownerId", v)}
              allLabel={fl.all}
              options={owners.map((o) => ({ value: o.id, label: o.name }))}
            />
          </FilterField>
          <FilterField label={fl.client} htmlFor="f-client">
            <OptionSelect
              id="f-client"
              value={optimistic.clientId}
              onChange={(v) => setFilter("clientId", v)}
              allLabel={fl.all}
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
            />
          </FilterField>
          <FilterField label={fl.source} htmlFor="f-source">
            <OptionSelect
              id="f-source"
              value={optimistic.source}
              onChange={(v) => setFilter("source", v)}
              allLabel={fl.all}
              options={TRANSACTION_SOURCES.map((v) => ({ value: v, label: t.enums.source[v] }))}
            />
          </FilterField>
          <FilterField label={fl.status} htmlFor="f-status">
            <OptionSelect
              id="f-status"
              value={optimistic.status === "all" ? null : optimistic.status}
              onChange={(v) => setFilter("status", v ?? "all")}
              allLabel={fl.all}
              options={[
                { value: "active" as const, label: fl.statusActive },
                { value: "voided" as const, label: fl.statusVoided },
              ]}
            />
          </FilterField>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-h-7 items-center gap-2 text-xs text-muted-foreground">
            <span aria-live="polite">
              {data.total === 0 ? fl.none : interpolate(fl.showing, { from: firstRow, to: lastRow, total: data.total })}
            </span>
            {filtered && (
              <Button variant="ghost" size="xs" onClick={() => navigate(EMPTY_LEDGER_FILTERS)}>
                <X aria-hidden />
                {fl.clear}
              </Button>
            )}
          </div>
          <AdminOnly>
            <Button onClick={() => setDialog({ kind: "sale" })}>
              <Plus aria-hidden />
              {t.transactions.actions.newSale}
            </Button>
          </AdminOnly>
        </div>
      </Card>

      {/* ── Results ───────────────────────────────────────────── */}
      <div
        className={cn("grid gap-4 transition-opacity", pending && "pointer-events-none opacity-60")}
        aria-busy={pending}
      >
        {data.total === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title={filtered ? t.transactions.empty.noMatches : t.transactions.empty.noData}
            hint={filtered ? t.transactions.empty.noMatchesHint : t.transactions.empty.noDataHint}
            action={
              filtered ? (
                <Button variant="outline" onClick={() => navigate(EMPTY_LEDGER_FILTERS)}>
                  <X aria-hidden />
                  {fl.clear}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Desktop / tablet */}
            <Card className="hidden gap-0 py-0 md:flex">
              <Table>
                <TableHeader className="bg-muted/40">
                  {table.getHeaderGroups().map((group) => (
                    <TableRow key={group.id} className="hover:bg-transparent">
                      {group.headers.map((header) => {
                        const meta = header.column.columnDef.meta as ColumnMeta | undefined;
                        return (
                          <TableHead
                            key={header.id}
                            className={cn("h-10 px-3 text-xs", meta?.align === "right" && "text-right", meta?.className)}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <Fragment key={row.id}>
                      <TableRow
                        data-state={row.getIsExpanded() ? "selected" : undefined}
                        className={cn(row.original.isVoided && "text-muted-foreground")}
                      >
                        {row.getVisibleCells().map((cell) => {
                          const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
                          return (
                            <TableCell
                              key={cell.id}
                              className={cn("px-3 py-2", meta?.align === "right" && "text-right", meta?.className)}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                      {row.getIsExpanded() && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={row.getVisibleCells().length} className="px-4 py-3 whitespace-normal">
                            <LedgerDetail row={row.original} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </Card>

            {/* Mobile */}
            <ul className="grid gap-2 md:hidden">
              {rows.map((row) => (
                <li key={row.id}>
                  <LedgerCard
                    row={row.original}
                    expanded={row.getIsExpanded()}
                    onToggle={row.getToggleExpandedHandler()}
                    openDialog={openDialog}
                  />
                </li>
              ))}
            </ul>

            <Pager
              page={data.page}
              pageCount={data.pageCount}
              onPage={(page) => navigate({ ...optimistic, page })}
              t={t}
            />
          </>
        )}
      </div>

      {/* ── Dialogs (mounted on open so each opens with fresh state) ── */}
      {dialog?.kind === "sale" && (
        <ManualSaleDialog open onOpenChange={closeDialog} products={products} clients={clients} />
      )}
      {dialog?.kind === "edit" && (
        <EditTransactionDialog open onOpenChange={closeDialog} row={dialog.row} clients={clients} />
      )}
      {dialog?.kind === "void" && <VoidTransactionDialog open onOpenChange={closeDialog} row={dialog.row} />}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Columns
 * ──────────────────────────────────────────────────────────────────────────── */

function buildColumns(t: Dictionary, locale: "en" | "es", openDialog: OpenDialog): ColumnDef<LedgerRow>[] {
  const c = t.transactions.columns;
  return [
    {
      id: "expand",
      header: () => <span className="sr-only">{t.transactions.expand}</span>,
      meta: { className: "w-8 pr-0" } satisfies ColumnMeta,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={row.getToggleExpandedHandler()}
          aria-expanded={row.getIsExpanded()}
          aria-label={`${row.getIsExpanded() ? t.transactions.collapse : t.transactions.expand} #${row.original.id}`}
        >
          <ChevronDown className={cn("transition-transform", row.getIsExpanded() && "rotate-180")} aria-hidden />
        </Button>
      ),
    },
    {
      id: "date",
      header: c.date,
      cell: ({ row }) => (
        <div className="grid gap-0.5 whitespace-nowrap">
          <span className="text-xs tabular-nums">{formatDateTime(row.original.occurredAt, locale)}</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            #{row.original.id}
            {row.original.legacyId !== null && ` · ${interpolate(t.transactions.legacy, { id: row.original.legacyId })}`}
          </span>
        </div>
      ),
    },
    {
      id: "type",
      header: c.type,
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1">
          <TypeBadge type={row.original.type} />
          {row.original.isVoided && <VoidedBadge />}
        </div>
      ),
    },
    {
      id: "detail",
      header: c.detail,
      meta: { className: "w-full max-w-0" } satisfies ColumnMeta,
      cell: ({ row }) => (
        <p className="truncate text-sm" title={summarize(row.original)}>
          {summarize(row.original) || <span className="text-muted-foreground">—</span>}
        </p>
      ),
    },
    {
      id: "client",
      header: c.client,
      cell: ({ row }) => <span className="text-sm whitespace-nowrap">{row.original.clientName ?? "—"}</span>,
    },
    {
      id: "method",
      header: c.method,
      cell: ({ row }) => <MethodBadge method={row.original.paymentMethod} />,
    },
    {
      id: "source",
      header: c.source,
      meta: { className: "hidden xl:table-cell" } satisfies ColumnMeta,
      cell: ({ row }) => <SourceLabel source={row.original.source} />,
    },
    {
      id: "total",
      header: c.total,
      meta: { align: "right" } satisfies ColumnMeta,
      cell: ({ row }) => (
        <span className={cn("font-medium whitespace-nowrap tabular-nums", row.original.isVoided && "line-through")}>
          {formatCurrency(row.original.totalAmount)}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{c.actions}</span>,
      meta: { align: "right" } satisfies ColumnMeta,
      cell: ({ row }) => <RowActions row={row.original} t={t} openDialog={openDialog} />,
    },
  ];
}

/** One-line description: "2 × Coca-Cola, 1 × Oreo" or "Frank Bs. 500.00". */
function summarize(row: LedgerRow): string {
  if (row.debtPayments.length > 0) {
    return row.debtPayments.map((d) => `${d.ownerName} ${formatCurrency(d.amount)}`).join(", ");
  }
  return row.items
    .map((i) => `${Math.abs(i.quantityDelta)} × ${i.productName}`)
    .join(", ");
}

/* ────────────────────────────────────────────────────────────────────────────
 * Pieces
 * ──────────────────────────────────────────────────────────────────────────── */

function RowActions({
  row,
  t,
  openDialog,
  withLabels = false,
}: {
  row: LedgerRow;
  t: Dictionary;
  openDialog: OpenDialog;
  withLabels?: boolean;
}) {
  const a = t.transactions.actions;
  if (row.isVoided) return null;
  const items = [
    { kind: "edit" as const, label: a.edit, icon: Pencil, className: "" },
    { kind: "void" as const, label: a.void, icon: Ban, className: "text-destructive" },
  ];
  return (
    <div className={cn("flex items-center gap-1", withLabels ? "flex-wrap" : "justify-end")}>
      {items.map(({ kind, label, icon: Icon, className }) => (
        <AdminOnly key={kind} label={withLabels ? undefined : label}>
          <Button
            variant={withLabels ? "outline" : "ghost"}
            size={withLabels ? "sm" : "icon-sm"}
            aria-label={`${label} #${row.id}`}
            onClick={() => openDialog(kind, row)}
            className={className}
          >
            <Icon aria-hidden />
            {withLabels && <span className="text-foreground">{label}</span>}
          </Button>
        </AdminOnly>
      ))}
    </div>
  );
}

/** Expanded row: line items or debt-payment split, notes and void info. */
export function LedgerDetail({ row }: { row: LedgerRow }) {
  const { t, locale } = useI18n();
  const d = t.transactions.detail;

  return (
    <div className="grid gap-3 text-sm">
      {row.isVoided && row.voidedAt && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {interpolate(t.transactions.voidedInfo, {
            date: formatDateTime(row.voidedAt, locale),
            reason: row.voidReason ?? "—",
          })}
        </p>
      )}

      {row.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">{d.product}</th>
                <th className="px-3 py-1.5 text-right font-medium">{d.qty}</th>
                <th className="px-3 py-1.5 text-right font-medium">{d.unitPrice}</th>
                <th className="hidden px-3 py-1.5 text-right font-medium sm:table-cell">{d.unitCost}</th>
                <th className="px-3 py-1.5 text-left font-medium">{d.owner}</th>
                <th className="px-3 py-1.5 text-right font-medium">{d.lineTotal}</th>
              </tr>
            </thead>
            <tbody>
              {row.items.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="px-3 py-1.5">
                    <span className="font-medium">{i.productName}</span>{" "}
                    <span className="font-mono text-[11px] text-muted-foreground">{i.sku}</span>
                  </td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-medium tabular-nums",
                      i.quantityDelta < 0 ? "text-destructive" : "text-success",
                    )}
                  >
                    {i.quantityDelta > 0 ? `+${i.quantityDelta}` : i.quantityDelta}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(i.unitPrice)}</td>
                  <td className="hidden px-3 py-1.5 text-right text-muted-foreground tabular-nums sm:table-cell">
                    {formatCurrency(i.unitCost)}
                  </td>
                  <td className="px-3 py-1.5">
                    <OwnerBadge ownerId={i.ownerId} name={i.ownerName} />
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">{formatCurrency(i.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {row.debtPayments.length > 0 && (
        <div className="grid gap-2">
          <p className="text-xs font-medium text-muted-foreground">{d.payments}</p>
          {row.debtPayments.map((dp) => {
            const itemsCents = dp.items.reduce((s, i) => s + toCents(i.lineTotal), 0);
            const creditCents = toCents(dp.amount) - itemsCents;
            return (
              <div key={dp.id} className="grid gap-1.5 rounded-lg border bg-background px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <OwnerBadge ownerId={dp.ownerId} name={dp.ownerName} />
                    <MethodBadge method={dp.method} />
                  </span>
                  <span className="font-medium tabular-nums">{formatCurrency(dp.amount)}</span>
                </div>
                {dp.items.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {d.unitsSettled}:{" "}
                    {dp.items.map((i) => `${i.quantity} × ${i.productName} (${formatCurrency(i.lineTotal)})`).join(", ")}
                  </p>
                )}
                {creditCents > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {d.cashCredit}: {formatCurrency(creditCents / 100)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {row.items.length === 0 && row.debtPayments.length === 0 && (
        <p className="text-xs text-muted-foreground">{d.noItems}</p>
      )}

      <p className="text-xs">
        <span className="font-medium text-muted-foreground">{d.notes}: </span>
        {row.notes || <span className="text-muted-foreground italic">{d.noNotes}</span>}
      </p>
    </div>
  );
}

function LedgerCard({
  row,
  expanded,
  onToggle,
  openDialog,
}: {
  row: LedgerRow;
  expanded: boolean;
  onToggle: () => void;
  openDialog: OpenDialog;
}) {
  const { t, locale } = useI18n();
  return (
    <Card size="sm" className={cn("gap-2 px-3", row.isVoided && "opacity-75")}>
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <TypeBadge type={row.type} />
            <MethodBadge method={row.paymentMethod} />
            {row.isVoided && <VoidedBadge />}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDateTime(row.occurredAt, locale)} · #{row.id}
          </span>
        </div>
        <span className={cn("font-semibold whitespace-nowrap tabular-nums", row.isVoided && "line-through")}>
          {formatCurrency(row.totalAmount)}
        </span>
      </div>
      <p className="line-clamp-2 text-sm">{summarize(row) || "—"}</p>
      {row.clientName && <p className="text-xs text-muted-foreground">{row.clientName}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={expanded}>
          <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} aria-hidden />
          {expanded ? t.transactions.collapse : t.transactions.expand}
        </Button>
        <RowActions row={row} t={t} openDialog={openDialog} withLabels />
      </div>
      {expanded && (
        <div className="border-t pt-2">
          <LedgerDetail row={row} />
        </div>
      )}
    </Card>
  );
}

function Pager({
  page,
  pageCount,
  onPage,
  t,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  t: Dictionary;
}) {
  const p = t.transactions.pager;
  if (pageCount <= 1) return null;
  return (
    <nav className="flex items-center justify-between gap-2" aria-label={interpolate(p.page, { page, pages: pageCount })}>
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft aria-hidden />
        {p.prev}
      </Button>
      <span className="text-xs text-muted-foreground tabular-nums">{interpolate(p.page, { page, pages: pageCount })}</span>
      <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
        {p.next}
        <ChevronRight aria-hidden />
      </Button>
    </nav>
  );
}

function FilterField({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
