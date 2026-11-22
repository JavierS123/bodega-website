"use client";

import { Bot, FileSpreadsheet, MousePointerClick, Send, type LucideIcon } from "lucide-react";

import type { PaymentMethod, TransactionSource, TransactionType } from "@/db/schema";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

const chip =
  "inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset";

const TYPE_STYLES: Record<TransactionType, string> = {
  SALE: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  DEBT_PAYMENT: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900",
  RESTOCK: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900",
  STOCK_ADJUSTMENT: "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-300 dark:ring-zinc-700",
};

const METHOD_STYLES: Record<PaymentMethod, string> = {
  CASH: "bg-lime-50 text-lime-800 ring-lime-200 dark:bg-lime-950/40 dark:text-lime-300 dark:ring-lime-900",
  PAGO_MOVIL: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900",
  FIADO: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  NONE: "bg-transparent text-muted-foreground ring-transparent",
};

const SOURCE_ICONS: Record<TransactionSource, LucideIcon> = {
  WEB_AI: Bot,
  WEB_MANUAL: MousePointerClick,
  TELEGRAM: Send,
  CSV_IMPORT: FileSpreadsheet,
};

export function TypeBadge({ type }: { type: TransactionType }) {
  const { t } = useI18n();
  return <span className={cn(chip, TYPE_STYLES[type])}>{t.enums.type[type]}</span>;
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
    <span className={cn(chip, "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900")}>
      {t.transactions.voidedBadge}
    </span>
  );
}
