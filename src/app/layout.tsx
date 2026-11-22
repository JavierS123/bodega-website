import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Suspense } from "react";

import { AppShell, AppShellFallback } from "@/components/layout/app-shell";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BodegaOS",
  description: "Inventory, AI cashier & business intelligence for a neighborhood shop.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {/* Adds .dark on <html> before paint (no flash); remembers the choice in localStorage. */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {/* Locale + session are request-time data, so the shell streams in. */}
          <Suspense fallback={<AppShellFallback />}>
            <AppShell>{children}</AppShell>
          </Suspense>
          <Toaster richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
