"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { hasSupabaseEnv } from "@/lib/auth/env";
import { isAdmin } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/auth/server";

export type SignInErrorCode =
  | "invalidInput"
  | "invalidCredentials"
  | "notAdmin"
  | "notConfigured"
  | "unknown";

export type SignInState = { error: SignInErrorCode | null; email?: string };

const signInSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(256),
});

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { error: "invalidInput", email };
  if (!hasSupabaseEnv()) return { error: "notConfigured", email };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    return { error: error?.status === 400 ? "invalidCredentials" : "unknown", email };
  }

  // Only admins may hold a session — anyone else is signed straight back out.
  if (!isAdmin(data.user)) {
    await supabase.auth.signOut();
    return { error: "notAdmin", email };
  }

  redirect("/");
}

export async function signOut(): Promise<void> {
  if (hasSupabaseEnv()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/");
}
