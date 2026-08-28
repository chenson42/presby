import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

/**
 * The platform's own typeface (PresbyPortal Brand Guidelines v1.0,
 * docs/work-log/2026-08-27-presbyportal-brand-kit.md, DECISION-127). The kit
 * specifies "Inter Display" for headings/24px+ and "Inter" below — Google
 * Fonts has no separate "Inter Display" family, so this applies plain Inter
 * everywhere at platform level, matching the kit's own fallback chain
 * (`"Inter Display", "Inter", system-ui`). Applied on <body> so it's the
 * default everywhere; `(org)` pages still override it per-organization via
 * `fontPairing.bodyClassName` on <main> (src/lib/brand/fonts.ts) — a
 * property set directly on a descendant always wins over an inherited one,
 * regardless of the two classes' equal specificity.
 */
const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "PresbyPortal",
    template: "%s · PresbyPortal",
  },
  description:
    "Multitenant church and council management for Presbyterian congregations, presbyteries, and synods.",
  // OpenGraph is not decoration here. Church pages get shared into Facebook,
  // group texts, and in-app browsers constantly, and a link with no preview
  // reads as broken. It also silences third-party scripts (extensions, in-app
  // webviews) that assume every page has og:type and call .content on the null
  // returned by querySelector.
  openGraph: {
    type: "website",
    siteName: "PresbyPortal",
    title: "PresbyPortal",
    description:
      "Multitenant church and council management for Presbyterian congregations, presbyteries, and synods.",
  },
  twitter: { card: "summary" },
  robots: { index: false, follow: false }, // pre-release; revisit before launch
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} min-h-screen antialiased`}>
        {/*
         * pattern: server-action → client toast
         * Server actions return { ok, error? }. Client components read the result
         * and call toast.success() / toast.error() here in the Toaster singleton.
         * Never call toast() inside a 'use server' function — it is browser-only.
         * Do not add 'use client' to THIS file — <ThemeProvider> is a client
         * WRAPPER (src/components/theme-provider.tsx), which the App Router
         * accepts as a client leaf around server children with no ceremony;
         * this file itself stays a server component. `suppressHydrationWarning`
         * on <html> (NOT <body>) is required because next-themes' pre-paint
         * script sets the `.dark` class and `style="color-scheme: …"` on
         * <html> before React hydrates — a mismatch React would otherwise warn
         * about on every request.
         */}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster richColors closeButton position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
