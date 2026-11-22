"use client";

import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { ChevronDown, HandCoins, Pencil, Search, UserPlus, Users, X } from "lucide-react";
import { Fragment, useCallback, useDeferredValue, useMemo, useState } from "react";

import { OwnerBadge } from "@/components/inventory/badges";
import { AdminOnly } from "@/components/layout/admin-only";
import { EmptyState } from "@/components/shared/empty-state";
import { MethodBadge } from "@/components/transactions/badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { interpolate, type Dictionary } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import { isSettled, type ClientDebtSummary } from "@/lib/clients/shared";
import type { OwnerOption } from "@/lib/inventory/shared";
import { toCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import { ClientFormDialog } from "./client-form-dialog";
import { DebtPaymentDialog } from "./debt-payment-dialog";

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; client: ClientDebtSummary }
  | { kind: "abono"; clientId: number | null; ownerId?: number }
  | null;
type OpenAbono = (clientId: number | null, ownerId?: number) => void;
type ColumnMeta = { align?: "right"; className?: string };

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function ClientsView({ clients, owners }: { clients: ClientDebtSummary[]; owners: OwnerOption[] }) {
  const { t, locale } = useI18n();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [showSettled, setShowSettled] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);

  const closeDialog = useCallback((open: boolean) => !open && setDialog(null), []);
  const openAbono = useCallback<OpenAbono>((clientId, ownerId) => setDialog({ kind: "abono", clientId, ownerId }), []);
  const openEdit = useCallback((client: ClientDebtSummary) => setDialog({ kind: "edit", client }), []);

  // Rank is the position in the full debt ranking, so it stays stable while filtering.
  const ranked = useMemo(() => clients.map((c, i) => ({ ...c, rank: i + 1 })), [clients]);
  const filtered = useMemo(() => {
    const q = fold(deferredSearch.trim());
    return ranked.filter(
      (c) => (showSettled || !isSettled(c.totalPending)) && (!q || fold(`${c.name} ${c.phone ?? ""}`).includes(q)),
    );
  }, [ranked, deferredSearch, showSettled]);

  const columns = useMemo(() => buildColumns(t, locale, openAbono, openEdit), [t, locale, openAbono, openEdit]);

  // TanStack Table manages its own memoization; the React Compiler is not enabled here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
    getRowId: (row) => String(row.id),
  });
  const rows = table.getRowModel().rows;
  const c = t.clients;

  return (
    <div className="grid gap-4">
      {/* ── Toolbar ── */}
      <div className="grid gap-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={c.search}
              aria-label={c.search}
              className="pl-8"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <AdminOnly>
              <Button variant="outline" onClick={() => setDialog({ kind: "create" })}>
                <UserPlus aria-hidden />
                {c.actions.add}
              </Button>
            </AdminOnly>
            <AdminOnly>
              <Button onClick={() => openAbono(null)}>
                <HandCoins aria-hidden />
                {c.actions.abono}
              </Button>
            </AdminOnly>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={showSettled}
              onChange={(e) => setShowSettled(e.target.checked)}
              className="size-4 accent-primary"
            />
            {c.showSettled}
          </label>
          <span aria-live="polite">{interpolate(c.showing, { shown: filtered.length, total: clients.length })}</span>
        </div>
      </div>

      {/* ── Results ── */}
      {clients.length === 0 ? (
        <EmptyState
          icon={Users}
          title={c.empty.noClients}
          hint={c.empty.noClientsHint}
          action={
            <AdminOnly>
              <Button onClick={() => setDialog({ kind: "create" })}>
                <UserPlus aria-hidden />
                {c.actions.add}
              </Button>
            </AdminOnly>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={c.empty.noMatches}
          hint={c.empty.noMatchesHint}
          action={
            <Button
              variant="outline"
              onClick={() => {
                setSearch("");
                setShowSettled(true);
              }}
            >
              <X aria-hidden />
              {t.transactions.filters.clear}
            </Button>
          }
        />
      ) : (
        <>
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
                    <TableRow data-state={row.getIsExpanded() ? "selected" : undefined}>
                      {row.getVisibleCells().map((cell) => {
                        const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
                        return (
                          <TableCell
                            key={cell.id}
                            className={cn("px-3 py-2.5", meta?.align === "right" && "text-right", meta?.className)}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                    {row.getIsExpanded() && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={row.getVisibleCells().length} className="px-4 py-3 whitespace-normal">
                          <ClientDetail client={row.original} openAbono={openAbono} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </Card>

          <ul className="grid gap-2 md:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <ClientCard
                  client={row.original}
                  rank={row.original.rank}
                  expanded={row.getIsExpanded()}
                  onToggle={row.getToggleExpandedHandler()}
                  openAbono={openAbono}
                  openEdit={openEdit}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {dialog?.kind === "create" && <ClientFormDialog open onOpenChange={closeDialog} />}
      {dialog?.kind === "edit" && <ClientFormDialog open onOpenChange={closeDialog} client={dialog.client} />}
      {dialog?.kind === "abono" && (
        <DebtPaymentDialog
          open
          onOpenChange={closeDialog}
          clients={clients}
          owners={owners}
          initialClientId={dialog.clientId}
          initialOwnerId={dialog.ownerId}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Columns
 * ──────────────────────────────────────────────────────────────────────────── */

type RankedClient = ClientDebtSummary & { rank: number };

function buildColumns(
  t: Dictionary,
  locale: "en" | "es",
  openAbono: OpenAbono,
  openEdit: (c: ClientDebtSummary) => void,
): ColumnDef<RankedClient>[] {
  const c = t.clients.columns;
  return [
    {
      id: "expand",
      header: () => <span className="sr-only">{t.clients.expand}</span>,
      meta: { className: "w-8 pr-0" } satisfies ColumnMeta,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={row.getToggleExpandedHandler()}
          aria-expanded={row.getIsExpanded()}
          aria-label={`${t.clients.expand}: ${row.original.name}`}
        >
          <ChevronDown className={cn("transition-transform", row.getIsExpanded() && "rotate-180")} aria-hidden />
        </Button>
      ),
    },
    {
      id: "rank",
      header: c.rank,
      meta: { className: "w-8 text-muted-foreground tabular-nums" } satisfies ColumnMeta,
      cell: ({ row }) => row.original.rank,
    },
    {
      id: "client",
      header: c.client,
      cell: ({ row }) => (
        <div className="grid gap-0.5">
          <span className="font-medium">{row.original.name}</span>
          {row.original.phone && <span className="text-xs text-muted-foreground">{row.original.phone}</span>}
        </div>
      ),
    },
    {
      id: "owners",
      header: c.owners,
      meta: { className: "w-full" } satisfies ColumnMeta,
      cell: ({ row }) => <OwnerDebtChips client={row.original} />,
    },
    {
      id: "lastActivity",
      header: c.lastActivity,
      meta: { className: "hidden lg:table-cell" } satisfies ColumnMeta,
      cell: ({ row }) =>
        row.original.lastActivity ? (
          <span className="text-xs whitespace-nowrap text-muted-foreground" title={formatDateTime(row.original.lastActivity, locale)}>
            {formatDate(row.original.lastActivity, locale)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{t.clients.neverActive}</span>
        ),
    },
    {
      id: "pending",
      header: c.pending,
      meta: { align: "right" } satisfies ColumnMeta,
      cell: ({ row }) => <PendingAmount amount={row.original.totalPending} t={t} />,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{c.actions}</span>,
      meta: { align: "right" } satisfies ColumnMeta,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <AdminOnly label={t.clients.actions.abono}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-success"
              aria-label={`${t.clients.actions.abono}: ${row.original.name}`}
              onClick={() => openAbono(row.original.id)}
              disabled={toCents(row.original.totalPending) <= 0}
            >
              <HandCoins aria-hidden />
            </Button>
          </AdminOnly>
          <AdminOnly label={t.clients.actions.edit}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${t.clients.actions.edit}: ${row.original.name}`}
              onClick={() => openEdit(row.original)}
            >
              <Pencil aria-hidden />
            </Button>
          </AdminOnly>
        </div>
      ),
    },
  ];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Pieces
 * ──────────────────────────────────────────────────────────────────────────── */

function PendingAmount({ amount, t }: { amount: string; t: Dictionary }) {
  const cents = toCents(amount);
  if (isSettled(amount)) {
    return <span className="text-xs font-medium text-success">{t.clients.settled}</span>;
  }
  return (
    <span
      className={cn(
        "font-semibold whitespace-nowrap tabular-nums",
        cents > 0 ? "text-destructive" : "text-success",
      )}
      title={cents < 0 ? t.clients.credit : undefined}
    >
      {formatCurrency(amount)}
    </span>
  );
}

function OwnerDebtChips({ client }: { client: ClientDebtSummary }) {
  const owed = client.owners.filter((o) => !isSettled(o.balance));
  if (owed.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {owed.map((o) => (
        <span key={o.ownerId} className="inline-flex items-center gap-1 text-xs whitespace-nowrap">
          <OwnerBadge ownerId={o.ownerId} name={o.ownerName} />
          <span className="tabular-nums">{formatCurrency(o.balance)}</span>
        </span>
      ))}
    </div>
  );
}

/** Expanded client: debt per owner (with outstanding units) + recent Fiado/Abono history. */
function ClientDetail({ client, openAbono }: { client: ClientDebtSummary; openAbono: OpenAbono }) {
  const { t, locale } = useI18n();
  const b = t.clients.breakdown;

  return (
    <div className="grid gap-4 text-sm lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="grid content-start gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">{b.byOwner}</h3>
        {client.owners.length === 0 ? (
          <p className="text-xs text-muted-foreground">{b.noOwnerDebt}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {client.owners.map((o) => (
              <div key={o.ownerId} className="grid content-start gap-2 rounded-lg border bg-background px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <OwnerBadge ownerId={o.ownerId} name={o.ownerName} />
                  <PendingAmount amount={o.balance} t={t} />
                </div>
                {o.units.length > 0 && (
                  <ul className="grid gap-0.5 text-xs text-muted-foreground tabular-nums">
                    {o.units.map((u) => (
                      <li key={u.productId} className="flex justify-between gap-2">
                        <span className="truncate">
                          {interpolate(b.unitLine, { qty: u.qty, product: u.productName, price: formatCurrency(u.price) })}
                        </span>
                        <span>{formatCurrency(u.value)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {toCents(o.cashCredit) !== 0 && (
                  <p className="flex justify-between gap-2 text-xs text-success tabular-nums">
                    <span>{b.cashCredit}</span>
                    <span>−{formatCurrency(o.cashCredit)}</span>
                  </p>
                )}
                {toCents(o.balance) > 0 && (
                  <AdminOnly>
                    <Button variant="outline" size="xs" className="justify-self-start" onClick={() => openAbono(client.id, o.ownerId)}>
                      <HandCoins aria-hidden />
                      {t.clients.actions.abono}
                    </Button>
                  </AdminOnly>
                )}
              </div>
            ))}
          </div>
        )}
        {(client.phone || client.notes) && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {client.phone && (
              <>
                <dt className="text-muted-foreground">{b.phone}</dt>
                <dd>{client.phone}</dd>
              </>
            )}
            {client.notes && (
              <>
                <dt className="text-muted-foreground">{b.notes}</dt>
                <dd>{client.notes}</dd>
              </>
            )}
          </dl>
        )}
      </section>

      <section className="grid content-start gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">{b.history}</h3>
        {client.history.length === 0 ? (
          <p className="text-xs text-muted-foreground">{b.noHistory}</p>
        ) : (
          <ol className="grid max-h-80 gap-1 overflow-y-auto rounded-lg border bg-background p-1">
            {client.history.map((h) => (
              <li
                key={h.transactionId}
                className={cn("grid gap-0.5 rounded-md px-2 py-1.5 hover:bg-muted/50", h.isVoided && "opacity-60")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs">
                    <span
                      className={cn(
                        "font-semibold",
                        h.kind === "FIADO" ? "text-warning" : "text-success",
                      )}
                    >
                      {h.kind === "FIADO" ? b.fiado : b.abono}
                    </span>
                    {h.method && <MethodBadge method={h.method} />}
                    {h.isVoided && <span className="text-destructive">· {b.voided}</span>}
                  </span>
                  <span className={cn("text-xs font-medium tabular-nums", h.isVoided && "line-through")}>
                    {h.kind === "FIADO" ? "+" : "−"}
                    {formatCurrency(h.amount)}
                  </span>
                </div>
                <div className="flex justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate" title={h.summary}>
                    {h.summary}
                  </span>
                  <span className="shrink-0 tabular-nums">{formatDate(h.occurredAt, locale)}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function ClientCard({
  client,
  rank,
  expanded,
  onToggle,
  openAbono,
  openEdit,
}: {
  client: ClientDebtSummary;
  rank: number;
  expanded: boolean;
  onToggle: () => void;
  openAbono: OpenAbono;
  openEdit: (c: ClientDebtSummary) => void;
}) {
  const { t } = useI18n();
  return (
    <Card size="sm" className="gap-2 px-3">
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <span className="font-medium">
            <span className="mr-1.5 text-xs text-muted-foreground tabular-nums">{rank}.</span>
            {client.name}
          </span>
          {client.phone && <span className="text-xs text-muted-foreground">{client.phone}</span>}
        </div>
        <PendingAmount amount={client.totalPending} t={t} />
      </div>
      <OwnerDebtChips client={client} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={expanded}>
          <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} aria-hidden />
          {t.clients.expand}
        </Button>
        <div className="flex gap-1">
          <AdminOnly>
            <Button variant="outline" size="sm" onClick={() => openAbono(client.id)} disabled={toCents(client.totalPending) <= 0}>
              <HandCoins aria-hidden />
              {t.clients.actions.abono}
            </Button>
          </AdminOnly>
          <AdminOnly label={t.clients.actions.edit}>
            <Button variant="outline" size="icon-sm" aria-label={t.clients.actions.edit} onClick={() => openEdit(client)}>
              <Pencil aria-hidden />
            </Button>
          </AdminOnly>
        </div>
      </div>
      {expanded && (
        <div className="border-t pt-2">
          <ClientDetail client={client} openAbono={openAbono} />
        </div>
      )}
    </Card>
  );
}
