"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The `(org)` error boundary.
 *
 * IT CANNOT NAME THE ORGANIZATION, and that is a framework fact rather than a
 * choice: in production Next replaces the error message with an opaque digest,
 * so anything this component says has to be true of every fault that can reach
 * it. The named, dated "your access to Alder Creek ended on 12 June" copy comes
 * from `resolveOrgContext()`'s `ended` branch instead, which is the common
 * path and renders a real page.
 *
 * What actually lands here is the RARE case: `OrgAccessError`, thrown by
 * `withOrgContext()` when the relationship disappears BETWEEN the resolve and
 * the transaction. The copy is written for that reading while staying honest
 * about a generic failure.
 *
 * Error boundaries must be Client Components — a Next requirement, and the one
 * `'use client'` in this pipeline.
 */
export default function OrgError({ reset }: { reset: () => void }) {
  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-semibold">
        We couldn&apos;t open this organization
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Your access to it may have ended or been removed while you were here.
        Your other organizations are unaffected.
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button onClick={reset} className="min-h-11 w-full sm:w-auto">
          Try again
        </Button>
        <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto">
          <Link href="/orgs">Back to your organizations</Link>
        </Button>
      </div>
    </section>
  );
}
