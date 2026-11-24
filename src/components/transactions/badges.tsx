"use client";

import { Bot, FileSpreadsheet, MousePointerClick, Send, type LucideIcon } from "lucide-react";

import type { OwnerSettlementType, PaymentMethod, TransactionSource } from "@/db/schema";
import { useI18n } from "@/lib/i18n/provider";
import type { LedgerType } from "@/lib/transactions/shared";
import { cn } from "@/lib/utils";

const chip =
  "inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset";

/** Ledger types: soft filled chips. Money in = success, debt collected = info, owner movement = chart-4. */
const TYPE_STYLES: Record<LedgerType, string> = {
  SALE: "bg-success/10 text-success ring-success/25",
  DEBT_PAYMENT: "bg-info/10 text-info ring-info/25",
  RESTOCK: "bg-primary/10 text-primary ring-primary/20",
  STOCK_ADJUSTMENT: "bg-muted text-muted-foreground ring-border",
  SETTLEMENT: "bg-chart-4/10 text-chart-4 ring-chart-4/25",
};

/** Payment methods: outline chips, so they read differently from the type chip next to them. */
const METHOD_STYLES: Record<PaymentMethod, string> = {
  CASH: "bg-transparent text-success ring-success/40",
  PAGO_MOVIL: "bg-transparent text-info ring-info/40",
  FIADO: "bg-transparent text-warning ring-warning/50",
  NONE: "bg-transparent text-muted-foreground ring-transparent",
};

const SOURCE_ICONS: Record<TransactionSource, LucideIcon> = {
  WEB_AI: Bot,
  WEB_MANUAL: MousePointerClick,
  TELEGRAM: Send,
  CSV_IMPORT: FileSpreadsheet,
};

/** Type chip; owner movements show their kind ("Transferencia", "Cambio de efectivo"…). */
export function TypeBadge({ type, settlementType }: { type: LedgerType; settlementType?: OwnerSettlementType | null }) {
  const { t } = useI18n();
  const label = type === "SETTLEMENT" && settlementType ? t.enums.settlement[settlementType] : t.enums.type[type];
  return <span className={cn(chip, TYPE_STYLES[type])}>{label}</span>;
}

export function MethodBadge({ method }: { method: PaymentMethod }) {
  const { t } = useI18n();
  if (method === "NONE") return <span className="text-xs text-muted-foreground">—</span>;
  return <span className={cn(chip, METHOD_STYLES[method])}>{t.enums.method[method]}</span>;
}

export function SourceLabel({ source }: { source: TransactionSource }) {
  const { t } = useI18n();
  const Icon = SOURCE_ICONS[source];
  return (
    <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {t.enums.source[source]}
    </span>
  );
}

export function VoidedBadge() {
  const { t } = useI18n();
  return (
    <span className={cn(chip, "bg-destructive/10 text-destructive ring-destructive/25")}>
      {t.transactions.voidedBadge}
    </span>
  );
}
