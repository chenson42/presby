import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

/**
 * THE ONE FAILURE-STATE COMPONENT for `/file-statistics`. Rendered for
 * EVERY dead-token cause — no token in the URL, nonexistent, expired,
 * revoked, already submitted, a stale (post-transfer) affiliation, the
 * feature flag off, or a genuine server error — with byte-identical copy
 * every time (Phase 2's enumeration-safety rule,
 * `docs/work-log/2026-09-25-submission-grants.md`). Never parameterized by
 * *why* the link is dead: a distinguishing prop here would be the same leak
 * Phase 2 spent its central finding on, just moved one layer up into JSX.
 *
 * Platform chrome only — no `<BrandTokens>`, no org name, no year, no logo.
 * `(statistics-submit)` is un-brandable (DECISION-047/147).
 */
export function GenericInactiveNotice() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4 py-16">
      <Card className="w-full">
        <CardContent className="space-y-3 text-center">
          <h1 className="text-2xl font-semibold">This link is no longer active</h1>
          <p className="text-sm text-muted-foreground">
            The link you followed can no longer be used to file a statistical
            report. It may have expired, already been used, or been revoked.
            Nothing was saved.
          </p>
          <p className="text-sm text-muted-foreground">
            If you still need to file, ask your presbytery for a new link.
          </p>
          <Link
            href="/"
            className="inline-block text-sm underline-offset-4 hover:underline"
          >
            Go to presbyportal.org
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
