"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Backstop only. The expected failure — the organization list cannot be read —
 * is caught in the page and rendered as <OrganizationsUnavailable>, because a
 * caught error can say something specific and this boundary cannot: Next
 * replaces the message with a digest in production, so anything rendered here
 * has to be true of every possible fault.
 *
 * Error boundaries must be Client Components; that is a framework requirement,
 * not a design choice.
 */
export default function OrgsError({ reset }: { reset: () => void }) {
  return (
    <section className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
        We couldn&apos;t load this page. Nothing about your access has changed.
      </p>
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button onClick={reset} className="min-h-11 w-full sm:w-auto">
          Try again
        </Button>
        <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto">
          <Link href="/home">Go to home</Link>
        </Button>
      </div>
    </section>
  );
}
