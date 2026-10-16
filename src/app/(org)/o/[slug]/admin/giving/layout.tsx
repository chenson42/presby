import type { ReactNode } from "react";
import { TestModeSlot } from "./test-mode-slot";

/**
 * Wraps every `/o/<slug>/admin/giving/**` page - docs/work-log/2026-10-15-
 * online-giving.md, Batch 3b. Its one job is the test-mode badge (G14): a
 * banner above the page while the open Stripe connection is a test-mode
 * account. NO AUTH OF ITS OWN, by the `(org)` contract (a layout cannot see the
 * pathname, so it cannot build a `callbackUrl`); the slot is silent unless the
 * viewer would pass the page gate, and each page still runs `gateGivingPage()`.
 * Route handlers (`connect/refresh`, `gifts/export`) are not wrapped by layouts.
 */
export default async function GivingAdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <div className="space-y-6">
      <TestModeSlot slug={slug} />
      {children}
    </div>
  );
}
