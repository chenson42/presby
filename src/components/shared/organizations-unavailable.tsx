import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The one honest answer when the organization list cannot be read.
 *
 * Shared by `/launch`, `/home` (DECISION-124 — this used to be `/orgs`) and
 * `/no-organization` — the three pages that
 * read it — because the alternative is three different sentences for one
 * condition, and because the failure mode this page exists to prevent is
 * subtle: a router that falls through to a zero-card chooser, or to `/home`,
 * when the database is unreachable tells the user their access was revoked.
 * That is a worse lie than an outage, and it generates a support ticket from
 * someone who did nothing wrong.
 *
 * It therefore RENDERS rather than redirects. `/launch` is a page that usually
 * redirects, not a page that always does.
 *
 * `retryHref` is the page the user is on. Re-requesting it is the whole retry —
 * a transient pool timeout is the common cause and the second attempt usually
 * succeeds. A `reset()`-style client boundary would need this to be a client
 * component for no gain.
 */
export function OrganizationsUnavailable({
  retryHref,
}: {
  retryHref: string;
}) {
  return (
    <section className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <h1 className="text-2xl font-semibold">
        We can&apos;t reach your congregations right now
      </h1>
      <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
        This is on our end, not yours — nothing about your access has changed.
        Try again in a moment.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={retryHref}>Try again</Link>
      </Button>
    </section>
  );
}
