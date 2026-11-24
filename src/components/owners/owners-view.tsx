"use client";

import { ArrowLeftRight, ChevronLeft, ChevronRight, Landmark, Plus, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { OwnerBadge } from "@/components/inventory/badges";
import { AdminOnly } from "@/components/layout/admin-only";
import { EmptyState } from "@/components/shared/empty-state";
import { MethodBadge } from "@/components/transactions/badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, formatDateTime, formatPercent } from "@/lib/format";
import { interpolate, type Dictionary } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import { centsToDecimal, toCents } from "@/lib/money";
import type { OwnerSummary, SettlementRow } from "@/lib/owners/shared";
import { cn } from "@/lib/utils";

import { SettlementDialog } from "./settlement-dialog";

const ALL = "all";
const SETTLEMENTS_PAGE_SIZE = 20;

/** Money fields of OwnerSummary that can be summed across owners. */
const MONEY_KEYS = [
  "invested",
  "capitalInjections",
  "restocks",
  "revenue",
  "salesCash",
  "salesPagoMovil",
  "abonosCash",
  "abonosPagoMovil",
  "netProfit",
  "pendingFiado",
  "cashCollected",
  "pagoMovilCollected",
  "cashOnHand",
  "porTransferir",
  "totalCorriente",
  "pagoMovilBalance",
  "injectionsCash",
  "injectionsPagoMovil",
  "paidOut",
  "cashDeposits",
  "withdrawals",
] as const satisfies readonly (keyof OwnerSummary)[];

function aggregate(list: OwnerSummary[], name: string): OwnerSummary {
  const total = Object.fromEntries(
    MONEY_KEYS.map((k) => [k, centsToDecimal(list.reduce((s, o) => s + toCents(o[k]), 0))]),
  ) as Record<(typeof MONEY_KEYS)[number], string>;
  const invested = toCents(total.invested);
  return {
    ownerId: 0,
    ownerName: name,
    ...total,
    roiPct: invested > 0 ? (toCents(total.netProfit) / invested) * 100 : null,
  };
}

export function OwnersView({ summaries, settlements }: { summaries: OwnerSummary[]; settlements: SettlementRow[] }) {
  const { t } = useI18n();
  const o = t.owners;
  const [selected, setSelected] = useState<string>(ALL);
  const [dialogOpen, setDialogOpen] = useState(false);

  const selectedId = selected === ALL ? null : Number(selected);
  const detail = useMemo(
    () => (selectedId ? summaries.find((s) => s.ownerId === selectedId) : undefined) ?? aggregate(summaries, o.all),
    [summaries, selectedId, o.all],
  );
  const visibleSettlements = useMemo(
    () => (selectedId ? settlements.filter((s) => s.ownerId === selectedId) : settlements),
    [settlements, selectedId],
  );

  return (
    <div className="grid gap-6">
      {/* ── Owner selector + action ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={selected} onValueChange={setSelected} className="min-w-0">
          <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
            <TabsList>
              <TabsTrigger value={ALL} className="px-3">
                {o.all}
              </TabsTrigger>
              {summaries.map((s) => (
                <TabsTrigger key={s.ownerId} value={String(s.ownerId)} className="px-3">
                  {s.ownerName}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
        <AdminOnly>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus aria-hidden />
            {o.actions.record}
          </Button>
        </AdminOnly>
      </div>

      {/* ── Comparative cards: all-time, then current balances ── */}
      <SectionHeading title={o.historical} hint={o.historicalHint} />
      <section className="-mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={o.historical}>
        {summaries.map((s) => (
          <HistoricalCard
            key={s.ownerId}
            summary={s}
            t={t}
            active={selectedId === s.ownerId}
            onSelect={() => setSelected(selectedId === s.ownerId ? ALL : String(s.ownerId))}
          />
        ))}
      </section>

      <SectionHeading title={o.current} hint={o.currentHint} />
      <section className="-mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={o.current}>
        {summaries.map((s) => (
          <CurrentCard
            key={s.ownerId}
            summary={s}
            t={t}
            active={selectedId === s.ownerId}
            onSelect={() => setSelected(selectedId === s.ownerId ? ALL : String(s.ownerId))}
          />
        ))}
      </section>

      {/* ── Detail for the selected owner (or all) ── */}
      <OwnerDetail summary={detail} t={t} />

      {/* ── Settlement history ── */}
      <SettlementHistory
        key={selected /* reset pagination when the owner changes */}
        rows={visibleSettlements}
        showOwner={selectedId === null}
        t={t}
      />

      {dialogOpen && (
        <SettlementDialog
          open
          onOpenChange={(next) => !next && setDialogOpen(false)}
          summaries={summaries}
          initialOwnerId={selectedId}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Pieces
 * ──────────────────────────────────────────────────────────────────────────── */

function signTone(amount: string) {
  const c = toCents(amount);
  return c > 0 ? "text-success" : c < 0 ? "text-destructive" : "";
}

function RoiBadge({ roi, t }: { roi: number | null; t: Dictionary }) {
  if (roi === null) return <span className="text-xs text-muted-foreground">{t.owners.metrics.roi} {t.owners.roiNa}</span>;
  const Icon = roi >= 0 ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-semibold tabular-nums ring-1 ring-inset",
        roi >= 0
          ? "bg-success/10 text-success ring-success/25"
          : "bg-destructive/10 text-destructive ring-destructive/25",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {t.owners.metrics.roi} {formatPercent(roi, 1)}
    </span>
  );
}

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="grid gap-0.5">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function SelectableCard({ active, onSelect, children }: { active: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <Card size="sm" className={cn("gap-3 px-4 transition-shadow", active && "ring-2 ring-primary")}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className="grid gap-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {children}
      </button>
    </Card>
  );
}

/** All-time: what the owner invested and collected, and the resulting profit. */
function HistoricalCard({
  summary: s,
  t,
  active,
  onSelect,
}: {
  summary: OwnerSummary;
  t: Dictionary;
  active: boolean;
  onSelect: () => void;
}) {
  const m = t.owners.metrics;
  return (
    <SelectableCard active={active} onSelect={onSelect}>
      <div className="flex items-center justify-between gap-2">
        <OwnerBadge ownerId={s.ownerId} name={s.ownerName} />
        <RoiBadge roi={s.roiPct} t={t} />
      </div>
      <div className="grid gap-0.5">
        <span className="text-xs text-muted-foreground">{m.netProfit}</span>
        <span className={cn("text-2xl font-semibold tracking-tight tabular-nums", signTone(s.netProfit))}>
          {formatCurrency(s.netProfit)}
        </span>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
        <Metric label={m.invested} value={s.invested} />
        <Metric label={m.revenue} value={s.revenue} strong />
        <div className="col-span-2 my-1 border-t" />
        <Metric label={m.cashHist} value={s.cashCollected} />
        <Metric label={m.pagoMovilHist} value={s.pagoMovilCollected} />
      </dl>
    </SelectableCard>
  );
}

/** Today: where the owner's money is (the sheet's "TOTALES ACTUALES"). */
function CurrentCard({
  summary: s,
  t,
  active,
  onSelect,
}: {
  summary: OwnerSummary;
  t: Dictionary;
  active: boolean;
  onSelect: () => void;
}) {
  const m = t.owners.metrics;
  const borrowed = toCents(s.totalCorriente) < 0;
  return (
    <SelectableCard active={active} onSelect={onSelect}>
      <div className="flex items-center justify-between gap-2">
        <OwnerBadge ownerId={s.ownerId} name={s.ownerName} />
        <Landmark className="size-4 text-muted-foreground" aria-hidden />
      </div>
      <div className="grid gap-0.5">
        <span className="text-xs text-muted-foreground">{m.pagoMovil}</span>
        <span
          className={cn(
            "text-2xl font-semibold tracking-tight tabular-nums",
            toCents(s.pagoMovilBalance) < 0 && "text-warning",
          )}
        >
          {formatCurrency(s.pagoMovilBalance)}
        </span>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
        <Metric label={m.totalCorriente} value={s.totalCorriente} tone={borrowed ? "borrowed" : undefined} />
        <Metric label={m.porTransferir} value={s.porTransferir} strong />
        <div className="col-span-2 my-1 border-t" />
        <Metric label={m.cash} value={s.cashOnHand} />
        <Metric label={m.pendingFiado} value={s.pendingFiado} tone={toCents(s.pendingFiado) > 0 ? "warn" : undefined} />
      </dl>
      {borrowed && <p className="text-[11px] leading-snug text-muted-foreground">{m.borrowed}</p>}
    </SelectableCard>
  );
}

function Metric({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  /** "borrowed": a negative amount is normal here (amber, not red). */
  tone?: "warn" | "borrowed";
}) {
  return (
    <>
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-right tabular-nums",
          strong && "font-semibold",
          (tone === "warn" || tone === "borrowed") && "text-warning",
          !tone && toCents(value) < 0 && "text-destructive",
        )}
      >
        {formatCurrency(value)}
      </dd>
    </>
  );
}

function OwnerDetail({ summary: s, t }: { summary: OwnerSummary; t: Dictionary }) {
  const m = t.owners.metrics;
  const ty = t.enums.settlement;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <DetailCard title={`${t.owners.historical} · ${s.ownerName}`} icon={<TrendingUp className="size-4" aria-hidden />}>
        <Line label={m.invested} hint={m.investedHint} value={s.invested} strong />
        <Line label={ty.CAPITAL_INJECTION} value={s.capitalInjections} indent />
        <Line label={t.enums.type.RESTOCK} value={s.restocks} indent />
        <Line label={m.revenue} hint={m.revenueHint} value={s.revenue} strong />
        <Line label={`${t.enums.type.SALE} · ${t.enums.method.CASH}`} value={s.salesCash} indent />
        <Line label={`${t.enums.type.SALE} · ${t.enums.method.PAGO_MOVIL}`} value={s.salesPagoMovil} indent />
        <Line label={`${t.enums.type.DEBT_PAYMENT} · ${t.enums.method.CASH}`} value={s.abonosCash} indent />
        <Line label={`${t.enums.type.DEBT_PAYMENT} · ${t.enums.method.PAGO_MOVIL}`} value={s.abonosPagoMovil} indent />
        <div className="my-1 border-t" />
        <div className="flex items-center justify-between gap-2">
          <span className="grid">
            <span className="font-medium">{m.netProfit}</span>
            <span className="text-xs text-muted-foreground">{m.netProfitHint}</span>
          </span>
          <span className="flex items-center gap-2">
            <RoiBadge roi={s.roiPct} t={t} />
            <span className={cn("text-lg font-semibold tabular-nums", signTone(s.netProfit))}>
              {formatCurrency(s.netProfit)}
            </span>
          </span>
        </div>
      </DetailCard>

      <DetailCard title={`${t.owners.current} · ${s.ownerName}`} icon={<Landmark className="size-4" aria-hidden />}>
        <Line label={m.pagoMovil} hint={m.pagoMovilHint} value={s.pagoMovilBalance} strong big tone="borrowed" />
        <Line label={`+ ${m.pmIn}`} value={s.pagoMovilCollected} indent />
        <Line label={`+ ${ty.CASH_DEPOSIT}`} value={s.cashDeposits} indent />
        <Line label={`+ ${ty.CAPITAL_INJECTION}`} value={s.injectionsPagoMovil} indent />
        <Line label={`− ${t.enums.type.RESTOCK}`} value={s.restocks} indent />
        <Line label={`− ${m.withdrawals}`} value={s.withdrawals} indent />
        <div className="my-1 border-t" />
        <Line
          label={`${t.owners.sharedAccount} · ${m.porTransferir}`}
          hint={m.porTransferirHint}
          value={s.porTransferir}
          strong
        />
        <Line
          label={`${t.owners.personalAccount} · ${m.totalCorriente}`}
          hint={m.totalCorrienteHint}
          value={s.totalCorriente}
          strong
          tone="borrowed"
        />
        <Line label={`↳ ${m.paidOut}`} value={s.paidOut} indent />
        {toCents(s.totalCorriente) < 0 && <p className="text-xs text-warning">{m.borrowed}</p>}
        <div className="my-1 border-t" />
        <Line label={m.cash} hint={m.cashHint} value={s.cashOnHand} strong />
        <Line label={m.pendingFiado} hint={m.pendingFiadoHint} value={s.pendingFiado} />
      </DetailCard>
    </div>
  );
}

function DetailCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Card size="sm" className="gap-2 px-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h2>
      <div className="grid gap-1.5 text-sm">{children}</div>
    </Card>
  );
}

function Line({
  label,
  hint,
  value,
  strong,
  indent,
  big,
  tone,
}: {
  label: string;
  hint?: string;
  value: string;
  strong?: boolean;
  indent?: boolean;
  big?: boolean;
  /** "borrowed": a negative amount is normal here (amber, not red). */
  tone?: "borrowed";
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", indent && "pl-4 text-xs text-muted-foreground")}>
      <span className="grid min-w-0">
        <span className={cn("truncate", strong && "font-medium")}>{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span
        className={cn(
          "shrink-0 tabular-nums",
          strong && "font-medium",
          big && "text-lg font-semibold",
          toCents(value) < 0 && (tone === "borrowed" ? "text-warning" : "text-destructive"),
        )}
      >
        {formatCurrency(value)}
      </span>
    </div>
  );
}

function SettlementHistory({ rows, showOwner, t }: { rows: SettlementRow[]; showOwner: boolean; t: Dictionary }) {
  const { locale } = useI18n();
  const st = t.owners.settlements;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / SETTLEMENTS_PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const slice = rows.slice((current - 1) * SETTLEMENTS_PAGE_SIZE, current * SETTLEMENTS_PAGE_SIZE);
  const from = rows.length === 0 ? 0 : (current - 1) * SETTLEMENTS_PAGE_SIZE + 1;
  const to = Math.min(current * SETTLEMENTS_PAGE_SIZE, rows.length);

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <ArrowLeftRight className="size-4" aria-hidden />
          {st.title}
        </h2>
        {rows.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {interpolate(st.showing, { from, to, total: rows.length })}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={ArrowLeftRight} title={st.empty} hint={t.owners.form.description} />
      ) : (
        <>
          <Card className="hidden gap-0 py-0 md:flex">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-10 px-3 text-xs">{st.date}</TableHead>
                  {showOwner && <TableHead className="h-10 px-3 text-xs">{st.owner}</TableHead>}
                  <TableHead className="h-10 px-3 text-xs">{st.type}</TableHead>
                  <TableHead className="h-10 px-3 text-xs">{st.method}</TableHead>
                  <TableHead className="h-10 w-full px-3 text-xs">{st.notes}</TableHead>
                  <TableHead className="h-10 px-3 text-right text-xs">{st.amount}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slice.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="px-3 py-2 text-xs whitespace-nowrap tabular-nums">
                      {formatDateTime(r.occurredAt, locale)}
                    </TableCell>
                    {showOwner && (
                      <TableCell className="px-3 py-2">
                        <OwnerBadge ownerId={r.ownerId} name={r.ownerName} />
                      </TableCell>
                    )}
                    <TableCell className="px-3 py-2 text-sm whitespace-nowrap">{t.enums.settlement[r.type]}</TableCell>
                    <TableCell className="px-3 py-2">
                      <MethodBadge method={r.method} />
                    </TableCell>
                    <TableCell className="max-w-0 px-3 py-2">
                      <p className="truncate text-xs text-muted-foreground" title={r.notes ?? undefined}>
                        {r.notes ?? "—"}
                      </p>
                    </TableCell>
                    <TableCell className={cn("px-3 py-2 text-right font-medium whitespace-nowrap tabular-nums", settlementTone(r))}>
                      {settlementSign(r)}
                      {formatCurrency(r.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <ul className="grid gap-2 md:hidden">
            {slice.map((r) => (
              <li key={r.id}>
                <Card size="sm" className="gap-1.5 px-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <OwnerBadge ownerId={r.ownerId} name={r.ownerName} />
                      <span className="text-sm font-medium">{t.enums.settlement[r.type]}</span>
                    </span>
                    <span className={cn("font-semibold tabular-nums", settlementTone(r))}>
                      {settlementSign(r)}
                      {formatCurrency(r.amount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="tabular-nums">{formatDateTime(r.occurredAt, locale)}</span>
                    <MethodBadge method={r.method} />
                  </div>
                  {r.notes && <p className="truncate text-xs text-muted-foreground">{r.notes}</p>}
                </Card>
              </li>
            ))}
          </ul>

          {pageCount > 1 && (
            <nav className="flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" disabled={current <= 1} onClick={() => setPage(current - 1)}>
                <ChevronLeft aria-hidden />
                {t.transactions.pager.prev}
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                {interpolate(t.transactions.pager.page, { page: current, pages: pageCount })}
              </span>
              <Button variant="outline" size="sm" disabled={current >= pageCount} onClick={() => setPage(current + 1)}>
                {t.transactions.pager.next}
                <ChevronRight aria-hidden />
              </Button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

/** From the shop's point of view: injections bring money in, payouts take it out. */
function settlementSign(r: SettlementRow) {
  return r.type === "CAPITAL_INJECTION" ? "+" : r.type === "PAYOUT_TRANSFER" ? "−" : "";
}
function settlementTone(r: SettlementRow) {
  return r.type === "CAPITAL_INJECTION"
    ? "text-success"
    : r.type === "PAYOUT_TRANSFER"
      ? "text-destructive"
      : "text-muted-foreground";
}
