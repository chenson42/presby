import Link from "next/link";
import { auth } from "@/auth";
import {
  listDeadLetters,
  listIngestHealth,
  listOrganizationNames,
  type DeadLetterRow,
  type IngestHealthRow,
} from "@/lib/admin/giving-ingest-health";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { DeadLettersTable } from "./dead-letters-table";
import { IngestHealthTable } from "./ingest-health-table";

/**
 * `/admin/giving` - the PLATFORM operator's view of the giving webhook inbox
 * (docs/work-log/2026-10-15-online-giving.md, P3-6, DECISION-175 (4), Batch 3b).
 * Per Stripe connection: notices received / applied / waiting / dead-lettered
 * and how long the oldest has waited; below it, every dead letter with a
 * Requeue control. Gate: `FEATURES.ADMIN_ORGANIZATIONS`, rendered INLINE (the
 * organizations pages' pattern), not a redirect.
 *
 * NO DONOR DATA, by construction. Every number and id here comes through
 * `src/lib/admin/giving-ingest-health.ts` (the only module that reaches the
 * owner-only database functions), which cannot return an amount, a name or an
 * event body. Organization names are the public `organizations.name`. This page
 * is the platform axis: it grants no access to any congregation's own pages.
 * Platform palette; no `loading.tsx` needed (the page renders its own error
 * state in place when a read fails).
 */

export default async function PlatformGivingHealthPage() {
  const session = await auth();
  if (!hasFeature(session?.user?.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Giving</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          You don&apos;t have permission to view giving health.
        </p>
      </div>
    );
  }

  let health: IngestHealthRow[] = [];
  let deadLetters: DeadLetterRow[] = [];
  let names = new Map<string, string>();
  let failed = false;
  try {
    [health, deadLetters] = await Promise.all([listIngestHealth(), listDeadLetters()]);
    names = await listOrganizationNames([...health, ...deadLetters].map((r) => r.organizationId));
  } catch {
    failed = true;
  }

  if (failed) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold">Giving</h1>
        <div className="mt-6 rounded-lg border border-dashed border-border p-4" data-testid="giving-health-error">
          <p className="text-sm font-medium">We can&apos;t load giving health right now</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing has changed. Reload the page in a moment.
          </p>
          <Link href="/admin/giving" className="mt-3 inline-flex min-h-11 items-center text-sm underline">
            Try again
          </Link>
        </div>
      </div>
    );
  }

  const parked = health.reduce((n, r) => n + r.parkedCount, 0);
  const dead = health.reduce((n, r) => n + r.deadLetterCount, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Giving</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The health of the payment notices Stripe sends for each congregation. Counts and times only: no gift, donor or
          amount is shown here.
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="giving-health-summary">
        <div className="rounded-lg border border-border p-4">
          <dt className="text-sm text-muted-foreground">Connections</dt>
          <dd className="text-2xl font-semibold tabular-nums">{health.length}</dd>
        </div>
        <div className="rounded-lg border border-border p-4">
          <dt className="text-sm text-muted-foreground">Notices waiting</dt>
          <dd className="text-2xl font-semibold tabular-nums">{parked}</dd>
        </div>
        <div className="rounded-lg border border-border p-4">
          <dt className="text-sm text-muted-foreground">Dead letters</dt>
          <dd className="text-2xl font-semibold tabular-nums">{dead}</dd>
        </div>
      </dl>

      <section aria-labelledby="health-heading" className="space-y-3">
        <h2 id="health-heading" className="text-xl font-semibold">
          Connections
        </h2>
        <IngestHealthTable rows={health} names={names} />
      </section>

      <section aria-labelledby="dead-heading" className="space-y-3">
        <h2 id="dead-heading" className="text-xl font-semibold">
          Dead letters
        </h2>
        <p className="text-sm text-muted-foreground">
          Notices presby gave up on after repeated failures. Requeue sends one back to be retried.
        </p>
        <DeadLettersTable rows={deadLetters} names={Object.fromEntries(names)} />
      </section>
    </div>
  );
}
