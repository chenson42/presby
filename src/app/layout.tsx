import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "presby",
    template: "%s · presby",
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
    siteName: "presby",
    title: "presby",
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
      <body className="min-h-screen antialiased">
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
