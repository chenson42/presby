import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Code Starter",
  description:
    "Fork-and-go Next.js + Neon + NextAuth starter with admin, roles, TOTP 2FA, feature flags, and release notes.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}
        {/*
         * pattern: server-action → client toast
         * Server actions return { ok, error? }. Client components read the result
         * and call toast.success() / toast.error() here in the Toaster singleton.
         * Never call toast() inside a 'use server' function — it is browser-only.
         * Do not add 'use client' to this file; <Toaster> is a client leaf in a
         * server tree, which Next.js App Router supports without any special handling.
         */}
        <Toaster theme="system" richColors closeButton position="top-right" />
      </body>
    </html>
  );
}
