import { ArrowLeft, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser, isAdmin } from "@/lib/auth/guards";
import { getDictionary } from "@/lib/i18n/server";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Admin sign in · BodegaOS",
  robots: { index: false },
};

export default async function LoginPage() {
  const [user, t] = await Promise.all([getCurrentUser(), getDictionary()]);
  if (isAdmin(user)) redirect("/");

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-4">
        <Card>
          <CardHeader>
            <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="size-5" aria-hidden />
            </div>
            <CardTitle className="text-xl">{t.auth.loginTitle}</CardTitle>
            <CardDescription>{t.auth.loginDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t.auth.backToDemo}
        </Link>
      </div>
    </div>
  );
}
