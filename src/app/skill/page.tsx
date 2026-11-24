import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { SkillView } from "@/components/skill/skill-view";
import { KpiStripSkeleton, TableSkeleton } from "@/components/shared/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { getFeedbackStats, getSkillDocs, listLessons } from "@/lib/ai/skill";
import { SKILL_SLUGS } from "@/lib/ai/skill-shared";
import { getDictionary } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "AI Skill",
  description: "The AI Cashier's editable knowledge: shop rules, lessons learned from owner feedback, and the /help message.",
};

export default async function SkillPage() {
  const t = await getDictionary();
  return (
    <PageContainer>
      <PageHeader title={t.skill.title} description={t.skill.subtitle} />
      <Suspense fallback={<SkillSkeleton />}>
        <SkillContent />
      </Suspense>
    </PageContainer>
  );
}

async function SkillContent() {
  await connection();
  // Sequential: one pooled connection per lambda in production.
  const stats = await getFeedbackStats();
  const lessons = await listLessons();
  const docs = await getSkillDocs(SKILL_SLUGS);
  return <SkillView stats={stats} lessons={lessons} docs={docs} />;
}

function SkillSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <KpiStripSkeleton count={4} />
      <Skeleton className="h-8 w-72 max-w-full" />
      <TableSkeleton rows={5} />
    </div>
  );
}
