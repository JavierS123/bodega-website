"use client";

import {
  Archive,
  ArchiveRestore,
  Ban,
  Check,
  CircleCheck,
  Gauge,
  Inbox,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { createLesson, resetSkillDoc, reviewLesson, saveSkillDoc, suggestLesson, type SkillErrorCode } from "@/actions/skill";
import { AdminOnly } from "@/components/layout/admin-only";
import { useSession } from "@/components/layout/session-provider";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LESSON_MAX,
  MAX_ACTIVE_LESSONS,
  SKILL_DOC_MAX,
  type FeedbackStats,
  type LessonView,
  type SkillDocData,
  type SkillSlug,
} from "@/lib/ai/skill-shared";
import { formatDateTime, formatPercent } from "@/lib/format";
import { interpolate } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

const textareaClass =
  "w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 read-only:bg-muted/40 dark:bg-input/30";

/** Runs a skill action, toasting success / the localized error. Returns whether it worked. */
function useSkillAction() {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const exec = <T,>(
    action: () => Promise<{ ok: true; data: T } | { ok: false; error: SkillErrorCode }>,
    success: string | null,
    onOk?: (data: T) => void,
  ) =>
    start(async () => {
      const r = await action();
      if (r.ok) {
        if (success) toast.success(success);
        onOk?.(r.data);
      } else {
        toast.error(t.skill.errors[r.error]);
      }
    });
  return { pending, exec };
}

export function SkillView({
  stats,
  lessons,
  docs,
}: {
  stats: FeedbackStats;
  lessons: LessonView[];
  docs: Record<SkillSlug, SkillDocData>;
}) {
  const { t } = useI18n();
  const s = t.skill;
  const proposed = lessons.filter((l) => l.status === "PROPOSED");
  const active = lessons.filter((l) => l.status === "ACTIVE");
  const archived = lessons.filter((l) => l.status === "ARCHIVED");
  const right = stats.confirmedClean + stats.cancelledUserError;
  const judged = right + stats.confirmedEdited + stats.cancelledAiWrong;
  const cancelled = stats.cancelledAiWrong + stats.cancelledUserError + stats.cancelledNoFeedback;

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Gauge}
          label={s.kpis.accuracy}
          value={stats.accuracy === null ? "—" : formatPercent(stats.accuracy * 100, 0)}
          hint={stats.accuracy === null ? s.kpis.accuracyEmpty : interpolate(s.kpis.accuracyHint, { right, judged })}
          tone={stats.accuracy === null ? "default" : stats.accuracy >= 0.9 ? "positive" : stats.accuracy >= 0.7 ? "default" : "warning"}
        />
        <KpiCard icon={CircleCheck} label={s.kpis.clean} value={String(stats.confirmedClean)} hint={s.kpis.cleanHint} tone="positive" />
        <KpiCard icon={Wrench} label={s.kpis.edited} value={String(stats.confirmedEdited)} hint={s.kpis.editedHint} />
        <KpiCard
          icon={Ban}
          label={s.kpis.cancelled}
          value={String(cancelled)}
          hint={interpolate(s.kpis.cancelledHint, {
            wrong: stats.cancelledAiWrong,
            user: stats.cancelledUserError,
            none: stats.cancelledNoFeedback,
          })}
        />
      </div>

      <Tabs defaultValue="lessons" className="grid gap-4">
        <div className="overflow-x-auto [scrollbar-width:none]">
          <TabsList>
            <TabsTrigger value="lessons" className="px-3">
              {s.tabs.lessons}
              {proposed.length > 0 && (
                <Badge className="ml-1 h-4 min-w-4 px-1 text-[10px] tabular-nums">{proposed.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="rules" className="px-3">
              {s.tabs.rules}
            </TabsTrigger>
            <TabsTrigger value="help" className="px-3">
              {s.tabs.help}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="lessons" className="grid gap-8">
          <Section title={`${s.pending} (${proposed.length})`} hint={s.pendingHint}>
            {proposed.length === 0 ? (
              <EmptyState icon={Inbox} title={s.pendingEmpty} hint={s.pendingEmptyHint} />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {proposed.map((l) => (
                  <ProposalCard key={l.id} lesson={l} />
                ))}
              </div>
            )}
          </Section>

          <Section
            title={`${s.active} (${active.length})`}
            hint={interpolate(s.activeHint, { max: MAX_ACTIVE_LESSONS })}
            action={<NewLessonButton />}
          >
            {active.length === 0 ? (
              <EmptyState icon={Sparkles} title={s.activeEmpty} hint={s.activeEmptyHint} />
            ) : (
              <Card className="gap-0 divide-y py-0">
                {active.map((l) => (
                  <LessonRow key={l.id} lesson={l} />
                ))}
              </Card>
            )}
          </Section>

          {archived.length > 0 && (
            <details className="group grid gap-3">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground select-none hover:text-foreground">
                {interpolate(s.archived, { count: archived.length })}
              </summary>
              <Card className="mt-3 gap-0 divide-y py-0 opacity-80">
                {archived.map((l) => (
                  <LessonRow key={l.id} lesson={l} />
                ))}
              </Card>
            </details>
          )}
        </TabsContent>

        <TabsContent value="rules">
          <DocEditor key={docKey(docs.rules)} doc={docs.rules} title={s.rulesTitle} hint={s.rulesHint} rows={22} mono />
        </TabsContent>

        <TabsContent value="help" className="grid gap-4 lg:grid-cols-2">
          <DocEditor key={docKey(docs.help_es)} doc={docs.help_es} title={`${s.helpTitle} · ${s.helpEs}`} hint={s.helpHint} rows={20} />
          <DocEditor key={docKey(docs.help_en)} doc={docs.help_en} title={`${s.helpTitle} · ${s.helpEn}`} hint={s.helpHint} rows={20} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Remount an editor when the server copy changes (save elsewhere, restore default). */
const docKey = (d: SkillDocData) => `${d.slug}:${d.isDefault}:${d.updatedAt ? new Date(d.updatedAt).getTime() : 0}`;

function Section({ title, hint, action, children }: { title: string; hint: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="grid gap-0.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{hint}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function OriginBadge({ origin }: { origin: LessonView["origin"] }) {
  const { t } = useI18n();
  return (
    <Badge variant={origin === "CANCEL_FEEDBACK" ? "destructive" : "secondary"} className="shrink-0">
      {t.skill.origin[origin]}
    </Badge>
  );
}

function Evidence({ label, children, icon: Icon }: { label: string; children: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className="flex items-start gap-1 text-sm break-words">
        {Icon && <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        {children}
      </span>
    </div>
  );
}

/* ── A proposal waiting for review ──────────────────────────────────────── */

function ProposalCard({ lesson }: { lesson: LessonView }) {
  const { t, locale } = useI18n();
  const s = t.skill;
  const { isAdmin } = useSession();
  const [text, setText] = useState(lesson.content);
  const { pending, exec } = useSkillAction();
  const [suggesting, startSuggest] = useTransition();
  const tooLong = text.trim().length > LESSON_MAX;

  function suggest() {
    startSuggest(async () => {
      const r = await suggestLesson({ id: lesson.id });
      if (r.ok) {
        setText(r.data.text);
        toast.success(s.toasts.suggested);
      } else {
        toast.error(s.errors[r.error]);
      }
    });
  }

  return (
    <Card size="sm" className="gap-3 px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <OriginBadge origin={lesson.origin} />
        <span className="text-xs text-muted-foreground tabular-nums">{formatDateTime(lesson.createdAt, locale)}</span>
      </div>
      <div className="grid gap-2 rounded-lg bg-muted/40 p-3">
        {lesson.exampleInput && <Evidence label={s.message}>«{lesson.exampleInput}»</Evidence>}
        {lesson.aiSummary && <Evidence label={s.aiUnderstood}>{lesson.aiSummary}</Evidence>}
        {lesson.finalSummary && <Evidence label={s.saved}>{lesson.finalSummary}</Evidence>}
        {lesson.comment && <Evidence label={s.comment}>“{lesson.comment}”</Evidence>}
      </div>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        {s.lesson}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          readOnly={!isAdmin}
          rows={3}
          placeholder={s.lessonPlaceholder}
          aria-invalid={tooLong || undefined}
          className={cn(textareaClass, "field-sizing-content min-h-20 font-normal text-foreground")}
        />
        <span className={cn("justify-self-end font-normal tabular-nums", tooLong && "text-destructive")}>
          {interpolate(s.chars, { count: text.trim().length, max: LESSON_MAX })}
        </span>
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <AdminOnly>
          <Button variant="outline" size="sm" onClick={suggest} disabled={suggesting || pending}>
            {suggesting ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
            {suggesting ? s.suggesting : s.suggest}
          </Button>
        </AdminOnly>
        <AdminOnly>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending || suggesting}
            onClick={() => exec(() => reviewLesson({ action: "discard", id: lesson.id }), s.toasts.discarded)}
          >
            <Trash2 aria-hidden />
            {s.discard}
          </Button>
        </AdminOnly>
        <AdminOnly>
          <Button
            size="sm"
            disabled={pending || suggesting || tooLong || text.trim().length < 3}
            onClick={() => exec(() => reviewLesson({ action: "approve", id: lesson.id, content: text }), s.toasts.approved)}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
            {s.approve}
          </Button>
        </AdminOnly>
      </div>
    </Card>
  );
}

/* ── Active / archived lesson ───────────────────────────────────────────── */

function LessonRow({ lesson }: { lesson: LessonView }) {
  const { t, locale } = useI18n();
  const s = t.skill;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(lesson.content);
  const { pending, exec } = useSkillAction();
  const archived = lesson.status === "ARCHIVED";
  const tooLong = text.trim().length > LESSON_MAX;

  return (
    <div className="grid gap-2 px-4 py-3">
      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          aria-label={s.lesson}
          aria-invalid={tooLong || undefined}
          className={cn(textareaClass, "field-sizing-content min-h-16")}
          autoFocus
        />
      ) : (
        <p className={cn("text-sm", archived && "text-muted-foreground line-through")}>{lesson.content}</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <OriginBadge origin={lesson.origin} />
          {lesson.exampleInput && <span className="truncate italic">«{lesson.exampleInput}»</span>}
          {lesson.reviewedAt && (
            <span className="tabular-nums">
              {formatDateTime(lesson.reviewedAt, locale)}
              {lesson.reviewedBy && ` ${interpolate(s.reviewedBy, { who: lesson.reviewedBy.split("@")[0] })}`}
            </span>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          {editing ? (
            <>
              <Button variant="ghost" size="xs" onClick={() => (setEditing(false), setText(lesson.content))} disabled={pending}>
                {s.cancel}
              </Button>
              <Button
                size="xs"
                disabled={pending || tooLong || text.trim().length < 3}
                onClick={() =>
                  exec(() => reviewLesson({ action: "edit", id: lesson.id, content: text }), s.toasts.saved, () => setEditing(false))
                }
              >
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
                {s.save}
              </Button>
            </>
          ) : (
            <>
              {!archived && (
                <AdminOnly>
                  <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
                    <Pencil aria-hidden />
                    {s.edit}
                  </Button>
                </AdminOnly>
              )}
              <AdminOnly>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={pending}
                  onClick={() =>
                    archived
                      ? exec(() => reviewLesson({ action: "restore", id: lesson.id }), s.toasts.restoredLesson)
                      : exec(() => reviewLesson({ action: "archive", id: lesson.id }), s.toasts.archived)
                  }
                >
                  {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                  {archived ? s.restore : s.archive}
                </Button>
              </AdminOnly>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Hand-written lesson ────────────────────────────────────────────────── */

function NewLessonButton() {
  const { t } = useI18n();
  const s = t.skill;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [example, setExample] = useState("");
  const { pending, exec } = useSkillAction();
  const tooLong = text.trim().length > LESSON_MAX;

  if (!open) {
    return (
      <AdminOnly>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus aria-hidden />
          {s.newLesson}
        </Button>
      </AdminOnly>
    );
  }
  return (
    <Card size="sm" className="w-full gap-2 px-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder={s.lessonPlaceholder}
        aria-label={s.lesson}
        aria-invalid={tooLong || undefined}
        className={cn(textareaClass, "field-sizing-content min-h-16")}
        autoFocus
      />
      <input
        value={example}
        onChange={(e) => setExample(e.target.value)}
        maxLength={500}
        placeholder={s.example}
        aria-label={s.example}
        className={cn(textareaClass, "h-8 py-1")}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
          {s.cancel}
        </Button>
        <Button
          size="sm"
          disabled={pending || tooLong || text.trim().length < 3}
          onClick={() =>
            exec(() => createLesson({ content: text, exampleInput: example }), s.toasts.created, () => {
              setOpen(false);
              setText("");
              setExample("");
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
          {s.save}
        </Button>
      </div>
    </Card>
  );
}

/* ── Skill document editor ──────────────────────────────────────────────── */

function DocEditor({
  doc,
  title,
  hint,
  rows,
  mono,
}: {
  doc: SkillDocData;
  title: string;
  hint: string;
  rows: number;
  mono?: boolean;
}) {
  const { t, locale } = useI18n();
  const s = t.skill;
  const { isAdmin } = useSession();
  const [text, setText] = useState(doc.content);
  const { pending, exec } = useSkillAction();
  const dirty = text !== doc.content;
  const length = text.trim().length;
  const invalid = length === 0 || length > SKILL_DOC_MAX;

  return (
    <Card size="sm" className="gap-3 px-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-0.5">
          <h2 className="font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{hint}</p>
        </div>
        <Badge variant={doc.isDefault ? "outline" : "secondary"}>{doc.isDefault ? s.defaultBadge : s.customBadge}</Badge>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        readOnly={!isAdmin}
        rows={rows}
        spellCheck={false}
        aria-label={title}
        aria-invalid={invalid || undefined}
        className={cn(textareaClass, mono && "font-mono text-xs leading-relaxed")}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          <span className={cn("tabular-nums", length > SKILL_DOC_MAX && "text-destructive")}>
            {interpolate(s.chars, { count: length, max: SKILL_DOC_MAX })}
          </span>
          {doc.updatedAt && (
            <span>
              {interpolate(s.updated, { date: formatDateTime(doc.updatedAt, locale) })}
              {doc.updatedBy && ` ${interpolate(s.reviewedBy, { who: doc.updatedBy.split("@")[0] })}`}
            </span>
          )}
          {dirty && <span className="font-medium text-warning">{s.unsaved}</span>}
        </span>
        <span className="flex gap-2">
          {!doc.isDefault && (
            <AdminOnly>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => exec(() => resetSkillDoc({ slug: doc.slug }), s.toasts.restored)}
              >
                <RotateCcw aria-hidden />
                {s.restoreDefault}
              </Button>
            </AdminOnly>
          )}
          <AdminOnly>
            <Button
              size="sm"
              disabled={pending || !dirty || invalid}
              onClick={() => exec(() => saveSkillDoc({ slug: doc.slug, content: text }), s.toasts.saved)}
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
              {pending ? s.saving : s.saveDoc}
            </Button>
          </AdminOnly>
        </span>
      </div>
    </Card>
  );
}
