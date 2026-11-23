import type { Metadata, Viewport } from "next";
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

/**
 * Absolute base for OpenGraph/Twitter image URLs: NEXT_PUBLIC_SITE_URL if set,
 * else Vercel's production domain, else localhost (dev).
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

const description =
  "Full-stack inventory, AI cashier and business-intelligence platform for a real neighborhood shop: " +
  "Gemini turns plain Spanish/English messages into editable sales, Fiado and restock cards; " +
  "Postgres keeps an auditable ledger; dashboards track margins, owner ROI and stockouts.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "BodegaOS — AI cashier & BI for a neighborhood shop",
    template: "%s · BodegaOS",
  },
  description,
  applicationName: "BodegaOS",
  keywords: ["Next.js", "Supabase", "PostgreSQL", "Drizzle", "Gemini", "AI cashier", "inventory", "business intelligence", "Venezuela"],
  openGraph: {
    type: "website",
    siteName: "BodegaOS",
    title: "BodegaOS — AI cashier & BI for a neighborhood shop",
    description,
    locale: "es_VE",
    alternateLocale: ["en_US"],
  },
  twitter: {
    card: "summary_large_image",
    title: "BodegaOS — AI cashier & BI for a neighborhood shop",
    description,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
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
