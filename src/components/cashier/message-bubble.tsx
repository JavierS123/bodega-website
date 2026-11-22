"use client";

import { AlertCircle, Bot, FlaskConical, Globe, Send } from "lucide-react";

import { isActionIntent, type ChatMessageView } from "@/lib/ai/shared";
import { formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

import { ConfirmationCard, type CardCatalog, type MessageUpdate } from "./confirmation-card";

export function MessageBubble({
  message,
  catalog,
  isAdmin,
  onUpdate,
}: {
  message: ChatMessageView;
  catalog: CardCatalog;
  isAdmin: boolean;
  onUpdate: (id: number, update: MessageUpdate) => void;
}) {
  const { t, locale } = useI18n();
  const isUser = message.role === "USER";
  const draft = message.payload?.draft;
  const hasCard = !isUser && draft && isActionIntent(draft.intent);
  const isError = message.status === "ERROR";

  return (
    <div className={cn("flex w-full gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bot className="size-4" aria-hidden />
        </div>
      )}
      <div className={cn("grid max-w-[min(34rem,88%)] gap-1.5", isUser && "justify-items-end")}>
        <div
          className={cn(
            "rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap",
            isUser
              ? "rounded-br-sm bg-primary text-primary-foreground"
              : isError
                ? "rounded-bl-sm bg-destructive/10 text-destructive"
                : "rounded-bl-sm bg-muted text-foreground",
          )}
        >
          {isError && <AlertCircle className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />}
          {message.content}
        </div>

        {hasCard && <ConfirmationCard message={message} catalog={catalog} isAdmin={isAdmin} onUpdate={onUpdate} />}

        <div className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
          <span className="font-medium">
            {isUser ? (message.senderName?.split("@")[0] ?? t.cashier.you) : t.cashier.assistant}
          </span>
          <SourceBadge source={message.source} />
          {message.sandbox && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-info/10 px-1.5 text-info">
              <FlaskConical className="size-3" aria-hidden />
              {t.cashier.sandboxBadge}
            </span>
          )}
          <time dateTime={message.createdAt.toISOString()} className="tabular-nums">
            {formatTime(message.createdAt, locale)}
          </time>
        </div>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: ChatMessageView["source"] }) {
  const { t } = useI18n();
  const Icon = source === "TELEGRAM" ? Send : Globe;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 ring-1 ring-inset",
        source === "TELEGRAM" ? "text-info ring-info/30" : "ring-border",
      )}
    >
      <Icon className="size-2.5" aria-hidden />
      {t.cashier.source[source]}
    </span>
  );
}
