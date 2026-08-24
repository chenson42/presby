import Link from "next/link";
import type { OrganizationType } from "@/lib/authz";
import { organizationTypeLabel } from "@/lib/org-display";
import { FormattedDate } from "@/components/shared/formatted-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * The three rendered answers `/o/<slug>` can give. The fourth — "no such
 * organization" — is `notFound()`, so it lives in `not-found.tsx` and carries a
 * real 404 status.
 *
 * One file because the three are a set, and reading them side by side is the
 * only practical way to keep the promise DECISION-040 makes about them.
 */

/**
 * ONE STRING, BYTE-IDENTICAL ACROSS `managed`, `invited`, AND `unmanaged`.
 *
 * This is the whole point of DECISION-040 and it is not a style preference. The
 * org tree is public information — PC(USA) publishes its congregations, and P2
 * is building a search over it — so naming the organization leaks nothing. What
 * must NOT leak is which congregations are our customers: that is commercial
 * and pastoral information the denomination does not publish, and a user
 * looping over a public slug list must not be able to infer it.
 *
 * So: no "not set up yet" variant, no status-dependent wording, and no
 * status-dependent branch that could vary response time. The resolution
 * deliberately hands this component no `platformStatus` to branch on — if you
 * find yourself fetching one to improve this copy, that is the leak arriving
 * disguised as helpfulness.
 *
 * It renders at HTTP 200 rather than 403: Next's `forbidden()` is still behind
 * `experimental.authInterrupts`, and enabling an experimental flag is not P0's
 * to take (DECISION-044(3)). The property the decision protects — one response
 * for all three statuses — is fully satisfied by the page.
 */
export function OrgAccessDenied({
  name,
  organizationType,
  slug,
}: {
  name: string;
  organizationType: OrganizationType;
  /**
   * Same enumeration-safety property as the rest of this component: the org
   * tree (and therefore its slug) is already public, and this exact page
   * already names the organization, so a link built from it discloses
   * nothing new. `/site/<slug>` collapses "not provisioned" into the same
   * 404 every other not-live reason produces (`getPublishedSite()`), so the
   * link is safe to render unconditionally rather than fetching
   * `sites.public_render`/`organization_sites.status` to decide whether to
   * show it — doing that would be a second, redundant status check of
   * exactly the kind DECISION-040 forbids this component from making.
   */
  slug: string;
}) {
  return (
    <section className="max-w-xl">
      <Badge variant="outline" className="font-normal">
        {organizationTypeLabel(organizationType)}
      </Badge>
      <h1 className="mt-3 text-2xl font-semibold">
        You don&apos;t have access to {name}
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        If you should have access, ask an administrator at that organization to
        add you. They will need the email address you signed in with.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild className="min-h-11">
          <Link href="/orgs">Back to your organizations</Link>
        </Button>
        <Button asChild variant="outline" className="min-h-11">
          <Link href={`/site/${slug}`}>Visit the public site</Link>
        </Button>
      </div>
    </section>
  );
}

/**
 * Named and dated, because the user already knew this organization exists and
 * that they were related to it — there is nothing left to disclose. This is the
 * common, humane path: `error.tsx` cannot say any of it, because Next replaces
 * an error message with a digest in production.
 */
export function OrgAccessEnded({
  name,
  endedOn,
  slug,
}: {
  name: string;
  /** 'YYYY-MM-DD'. A calendar date, never a Date — see FormattedDate. */
  endedOn: string;
  /** See `OrgAccessDenied`'s own `slug` doc comment — the same reasoning
   * applies here unchanged. */
  slug: string;
}) {
  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-semibold">Your access to {name} has ended</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Your relationship with this organization ended on{" "}
        <FormattedDate value={endedOn} mode="date" />. If that is not right, ask
        an administrator there to restore it.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild className="min-h-11">
          <Link href="/orgs">Back to your organizations</Link>
        </Button>
        <Button asChild variant="outline" className="min-h-11">
          <Link href={`/site/${slug}`}>Visit the public site</Link>
        </Button>
      </div>
    </section>
  );
}

/**
 * The landing stub. It reads NO tenant data of its own — it has already
 * called `assertOrgAccess()`, which runs the in-transaction membership
 * re-check and selects nothing, so P0 proves the whole gate end to end while
 * exposing nothing. The rest of the portal arrives page by page; the
 * directory is the first (P1).
 */
export function OrgPortalStub({
  name,
  organizationType,
  slug,
  directoryEnabled,
  rolesEnabled,
  ticketsEnabled,
}: {
  name: string;
  organizationType: OrganizationType;
  slug: string;
  /**
   * `org_portal.directory`'s value at render time — a TOGGLE, gating whether
   * the link exists at all. It is deliberately NOT gated on the viewer's own
   * `directory.view` grant: per Phase 1's adversarial pass, the permission
   * gate lives in server-side data-fetching, never a conditional `<Link>` —
   * `/o/<slug>/directory` is the sole authority on the viewer's own
   * permission and renders its own honest denied state.
   */
  directoryEnabled: boolean;
  /**
   * `org_portal.roles`'s value at render time (P9) — threaded through
   * exactly the way `directoryEnabled` already is, gated on the FLAG alone
   * and never on the viewer's own `role_grants.manage` grant.
   * `/o/<slug>/admin/roles` stays the sole authority on the viewer's own
   * permission and renders its own honest denied state.
   */
  rolesEnabled: boolean;
  /**
   * `org_portal.tickets`'s value at render time (support tickets pipeline)
   * — same split again: gates whether the "Tickets" and "Give feedback"
   * cards exist at all, never the viewer's own `tickets.file` grant.
   * `/o/<slug>/tickets` and `/o/<slug>/feedback` stay the sole authorities
   * on the viewer's own permission (or, for feedback, lack of one to check)
   * and render their own honest states.
   */
  ticketsEnabled: boolean;
}) {
  return (
    <section className="max-w-xl">
      <Badge variant="outline" className="font-normal">
        {organizationTypeLabel(organizationType)}
      </Badge>
      <h1 className="mt-3 text-2xl font-semibold">{name}</h1>
      {/*
       * NO "SWITCH ORGANIZATION" BUTTON HERE ANY MORE. It was P0's stand-in for
       * a control that did not exist yet; the header's org switcher is that
       * control, and two of them on one screen — one a picker, one a link to
       * the chooser, both labelled the same thing — is worse than one.
       */}
      <p className="mt-3 text-sm text-muted-foreground">
        You&apos;re in. There is nothing here yet — the roll and the officer
        register arrive with the organization portal.
      </p>
      <div className="flex flex-col items-start gap-2">
        {directoryEnabled && (
          <Link
            href={`/o/${slug}/directory`}
            className="mt-4 inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Directory →
          </Link>
        )}
        {rolesEnabled && (
          <Link
            href={`/o/${slug}/admin/roles`}
            className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Administration →
          </Link>
        )}
        {ticketsEnabled && (
          <Link
            href={`/o/${slug}/tickets`}
            className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Tickets →
          </Link>
        )}
        {ticketsEnabled && (
          <Link
            href={`/o/${slug}/feedback`}
            className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Give feedback →
          </Link>
        )}
      </div>
    </section>
  );
}
