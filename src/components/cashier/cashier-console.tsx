"use client";

import { ArrowUp, Bot, ChevronsUp, FlaskConical, Loader2, Sparkles } from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { loadOlderMessages, pollChat } from "@/actions/chat";
import { useSession } from "@/components/layout/session-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EXAMPLE_PROMPTS, MAX_MESSAGE_LENGTH, type ChatMessageView, type ChatPage, type ParseResponse } from "@/lib/ai/shared";
import { formatDate, toShopDateKey } from "@/lib/format";
import { interpolate } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";

import type { CardCatalog, MessageUpdate } from "./confirmation-card";
import { MessageBubble } from "./message-bubble";

const POLL_MS = 15_000;

/** Sandbox (visitor) messages get negative ids so they can never collide with Postgres ids. */
let sandboxSeq = 0;
const nextSandboxId = () => --sandboxSeq;

export function CashierConsole({ initial, catalog }: { initial: ChatPage; catalog: CardCatalog }) {
  const { t, locale } = useI18n();
  const { isAdmin } = useSession();
  const [messages, setMessages] = useState<ChatMessageView[]>(initial.messages);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Distance from the bottom before prepending older messages (restored after render). */
  const restoreFromBottom = useRef<number | null>(null);
  const stickToBottom = useRef(true);

  // Keep the view pinned to the newest message, except right after loading older ones.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restoreFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - restoreFromBottom.current;
      restoreFromBottom.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, sending]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onUpdate = useCallback((id: number, update: MessageUpdate) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...update } : m)));
  }, []);

  // Live feed: pick up messages from other devices / Telegram and cards resolved elsewhere.
  // Polls only while the tab is visible; read-only, so it is safe for visitors too.
  const latest = useRef(messages);
  useEffect(() => {
    latest.current = messages;
  }, [messages]);
  useEffect(() => {
    let busy = false;
    const tick = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const persisted = latest.current.filter((m) => m.id > 0);
        const afterId = persisted.reduce((max, m) => Math.max(max, m.id), 0);
        const pendingIds = persisted.filter((m) => m.status === "PENDING_CONFIRMATION").map((m) => m.id).slice(-100);
        const poll = await pollChat({ afterId, pendingIds });
        if (poll.messages.length === 0 && poll.updates.length === 0) return;
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          const patched = prev.map((m) => {
            const u = poll.updates.find((x) => x.id === m.id);
            return u ? { ...m, ...u } : m;
          });
          // Persisted messages stay in id order; sandbox (negative-id) messages stay at the end.
          const fresh = poll.messages.filter((m) => !known.has(m.id)).map((m) => ({ ...m, createdAt: new Date(m.createdAt) }));
          if (fresh.length === 0) return patched;
          return [...patched.filter((m) => m.id > 0), ...fresh, ...patched.filter((m) => m.id <= 0)];
        });
      } catch {
        // Offline or transient: the next tick retries.
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  async function loadOlder() {
    const oldest = messages.find((m) => m.id > 0);
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await loadOlderMessages({ beforeId: oldest.id });
      const el = scrollRef.current;
      restoreFromBottom.current = el ? el.scrollHeight - el.scrollTop : null;
      setMessages((prev) => [...page.messages, ...prev]);
      setHasMore(page.hasMore);
    } catch {
      toast.error(t.cashier.toasts.error);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send(text: string) {
    const message = text.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!message || sending) return;
    setSending(true);
    stickToBottom.current = true;
    setInput("");
    try {
      const res = await fetch("/api/ai/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = (await res.json()) as ParseResponse;
      if (!data.ok) {
        setInput(message); // give the text back so nothing is lost
        if (data.error === "rateLimited") {
          toast.error(interpolate(t.cashier.toasts.rateLimited, { min: Math.max(1, Math.ceil(data.retryAfterSec / 60)) }));
        } else {
          toast.error(data.error === "notConfigured" ? t.cashier.toasts.notConfigured : t.cashier.toasts.error);
        }
        return;
      }
      const revive = (m: ChatMessageView): ChatMessageView => ({
        ...m,
        createdAt: new Date(m.createdAt),
        id: data.persisted ? m.id : nextSandboxId(),
      });
      setMessages((prev) => [...prev, revive(data.user), revive(data.assistant)]);
    } catch {
      setInput(message);
      toast.error(t.cashier.toasts.error);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  }

  const showExamples = !isAdmin || messages.length === 0;
  const c = t.cashier;

  return (
    <Card className="h-[calc(100dvh-13rem)] min-h-[26rem] gap-0 overflow-hidden py-0">
      {!isAdmin && (
        <div className="flex items-center gap-2 border-b bg-info/5 px-4 py-2 text-xs text-info">
          <FlaskConical className="size-3.5 shrink-0" aria-hidden />
          <span>{c.sandboxNotice}</span>
        </div>
      )}

      {/* ── Thread ── */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 overflow-y-auto px-3 py-4 sm:px-5"
        role="log"
        aria-live="polite"
        aria-label={c.title}
      >
        <div className="mx-auto grid max-w-3xl gap-3">
          {hasMore && (
            <Button variant="outline" size="sm" className="justify-self-center" onClick={loadOlder} disabled={loadingOlder}>
              {loadingOlder ? <Loader2 className="animate-spin" aria-hidden /> : <ChevronsUp aria-hidden />}
              {loadingOlder ? c.loadingOlder : c.loadOlder}
            </Button>
          )}

          {messages.length === 0 && !sending && (
            <div className="grid justify-items-center gap-2 py-10 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bot className="size-6" aria-hidden />
              </div>
              <p className="font-medium">{c.emptyTitle}</p>
              <p className="max-w-sm text-sm text-muted-foreground">{c.emptyHint}</p>
            </div>
          )}

          {!isAdmin && messages.length > 0 && !messages[0].sandbox && (
            <p className="text-center text-[11px] tracking-wide text-muted-foreground uppercase">{c.feedLabel}</p>
          )}

          {messages.map((m, i) => {
            const day = toShopDateKey(m.createdAt);
            const newDay = i === 0 || toShopDateKey(messages[i - 1].createdAt) !== day;
            const sandboxStart = m.sandbox && !messages[i - 1]?.sandbox && i > 0;
            return (
              <Fragment key={m.id}>
                {(newDay || sandboxStart) && (
                  <div className="flex items-center gap-3 py-1 text-[11px] text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    {sandboxStart ? c.sandboxBadge : formatDate(m.createdAt, locale)}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                )}
                <MessageBubble message={m} catalog={catalog} isAdmin={isAdmin} onUpdate={onUpdate} />
              </Fragment>
            );
          })}

          {sending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bot className="size-4" aria-hidden />
              </div>
              <span className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-muted px-3 py-2">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {c.thinking}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Composer ── */}
      <div className="grid gap-2 border-t bg-background/60 px-3 py-3 sm:px-5">
        {showExamples && (
          <div className="mx-auto flex w-full max-w-3xl gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]" aria-label={c.examples}>
            <Sparkles className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {EXAMPLE_PROMPTS[locale].map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => void send(prompt)}
                disabled={sending}
                className="h-7 shrink-0 rounded-full border bg-background px-3 text-xs whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder={c.placeholder}
            aria-label={c.inputLabel}
            className="field-sizing-content max-h-32 min-h-9 flex-1 resize-none rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
          <Button type="submit" size="icon" className="size-9 shrink-0 rounded-xl" disabled={sending || !input.trim()} aria-label={c.send}>
            {sending ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUp aria-hidden />}
          </Button>
        </form>
      </div>
    </Card>
  );
}
