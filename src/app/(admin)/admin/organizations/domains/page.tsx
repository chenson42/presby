import Link from "next/link";
import { auth } from "@/auth";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormattedDate } from "@/components/shared/formatted-date";
import {
  listDomainsAcrossOrgs,
  parsePlatformListFilter,
  type PlatformDomainListRow,
  type PlatformListFilter,
} from "@/lib/domains/platform-read";

/**
 * All domains, across organizations (Flow 7, G31): the platform admin's
 * oversight list. Host, organization, state, hold, primary or alias, the last
 * check's outcome, when ownership was last confirmed, and how long an attached
 * host has gone without ever being live. Filter by state or "needs attention".
 * Read-only: the controls live on each organization's page, next to exactly what
 * the church sees. Platform palette, no brand. Reads on the platform connection
 * (`getPlatformDb`), which is correct here and forbidden under `(org)`.
 */

const FILTERS: Array<{ key: PlatformListFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
  { key: "held", label: "Paused or disputed" },
  { key: "pending", label: "Being connected" },
  { key: "live", label: "Live" },
  { key: "lapsed", label: "Lapsed or removed" },
  { key: "releasing", label: "Releasing" },
];

const STATE_LABEL: Record<string, string> = {
  pending: "Waiting for proof",
  verified: "Ownership confirmed",
  attach_pending: "Connecting",
  attached: "Securing",
  live: "Live",
  lapsed: "Lapsed",
  parked: "Removed (held)",
  release_pending: "Releasing",
};

const CHECK_LABEL: Record<string, string> = {
  ok: "Healthy",
  dns_unknown: "DNS lookup failed",
  provider_unavailable: "Hosting unavailable",
  config_error: "Hosting misconfigured",
  held_elsewhere: "Held elsewhere",
  provider_rejected: "Refused by hosting",
  rate_limited: "Rate limited",
};

function RowView({ r }: { r: PlatformDomainListRow }) {
  return (
    <TableRow data-domain={r.hostname}>
      <TableCell className="break-all font-medium">{r.hostname}</TableCell>
      <TableCell>
        <Link href={`/admin/organizations/${r.organizationId}`} className="underline underline-offset-4">
          {r.organizationName}
        </Link>
      </TableCell>
      <TableCell>{STATE_LABEL[r.state] ?? r.state}</TableCell>
      <TableCell>
        {r.hold ? <Badge variant="destructive">{r.hold === "paused" ? "Paused" : "Disputed"}</Badge> : "None"}
      </TableCell>
      <TableCell>{r.role === "canonical" ? "Primary" : r.role === "alias" ? "Alias" : r.purpose}</TableCell>
      <TableCell>{r.lastCheckClass ? (CHECK_LABEL[r.lastCheckClass] ?? r.lastCheckClass) : "Not checked"}</TableCell>
      <TableCell>{r.lastVerifiedAt ? <FormattedDate value={r.lastVerifiedAt} /> : "Never"}</TableCell>
      <TableCell>
        {r.daysAttachedNotLive === null ? "None" : `${r.daysAttachedNotLive} day${r.daysAttachedNotLive === 1 ? "" : "s"}`}
      </TableCell>
    </TableRow>
  );
}

export default async function DomainsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const session = await auth();
  if (!hasFeature(session?.user?.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Domains</h1>
        <p className="mt-3 text-sm text-muted-foreground">You don&apos;t have permission to manage organization domains.</p>
      </div>
    );
  }

  const filter = parsePlatformListFilter((await searchParams).filter);

  let result: Awaited<ReturnType<typeof listDomainsAcrossOrgs>> | null;
  try {
    result = await listDomainsAcrossOrgs(filter);
  } catch {
    result = null;
  }

  return (
    <div>
      <Link href="/admin/organizations" className="text-sm text-muted-foreground underline">
        ← Back to organizations
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">Domains</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every custom domain across organizations. Open an organization to pause, resume, dispute, force-release or
        check a host.
      </p>

      <nav aria-label="Filter domains" className="mt-6 flex flex-wrap gap-2 border-b border-border pb-3">
        {FILTERS.map((f) => (
          <Button key={f.key} asChild variant={filter === f.key ? "default" : "ghost"} size="sm" className="min-h-11 sm:min-h-8">
            <Link href={f.key === "all" ? "/admin/organizations/domains" : `/admin/organizations/domains?filter=${f.key}`} aria-current={filter === f.key ? "page" : undefined}>
              {f.label}
            </Link>
          </Button>
        ))}
      </nav>

      {result === null ? (
        <p role="alert" className="mt-6 text-sm text-muted-foreground">
          We couldn&apos;t load the domains right now. Reload to try again.
        </p>
      ) : result.rows.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground" data-testid="domains-list-empty">
          {filter === "all"
            ? "No organization has claimed a domain yet. Turn on Website domain for an organization from its page to let it start."
            : "Nothing matches this filter."}
        </p>
      ) : (
        <>
          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Host</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Hold</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last check</TableHead>
                <TableHead>Ownership last confirmed</TableHead>
                <TableHead>Attached, never live</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((r) => (
                <RowView key={r.id} r={r} />
              ))}
            </TableBody>
          </Table>
          {result.truncated && (
            <p className="mt-3 text-sm text-muted-foreground">Showing the first {result.rows.length}. Use a filter to narrow it.</p>
          )}
        </>
      )}
    </div>
  );
}
