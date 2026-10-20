import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { assertOrgAccess, OrgAccessError, resolveOrgContext } from "@/lib/authz";
import { DomainClaimCard } from "@/components/shared/domain-claim-card";
import { primaryAdvisory, type ChecklistGroup } from "@/lib/domains/checklist";
import { platformSiteAddress } from "@/lib/domains/site-address";
import { readDomainsView } from "@/lib/domains/service";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import { ActivityList } from "./activity-list";
import { CanonicalDialog } from "./canonical-dialog";
import { CheckNowButton } from "./check-now-button";
import { ClaimForm } from "./claim-form";
import { DomainsEmpty } from "./domains-empty";
import { DomainsFeatureOff, DomainsForbidden, DomainsUnavailable } from "./domains-states";
import { PrimaryAdvisoryBanner } from "./primary-advisory";
import { ReconnectButton } from "./reconnect-button";
import { RemoveDialog, type RemoveReplacement } from "./remove-dialog";

/**
 * `/o/<slug>/admin/domains` - connect a church's own web address to its public
 * site (Track F, Batch 1d; docs/work-log/2026-10-19-custom-domains.md Phase 3
 * Component / Page Plan).
 *
 * REPEATS THE `(org)` AUTH PATTERN IN FULL (the page, not the layout, so the
 * deep link survives): session -> `resolveOrgContext` (the four-way miss:
 * unknown 404, ended, denied, ok) -> `assertOrgAccess`. Then `readDomainsView`
 * runs the gate that matters inside `withOrgContext`: the `domains.manage`
 * permission, THEN the operator-enabled `org_portal.domains` toggle (an
 * operator, not the church, turns it on). Each refusal gets its own honest
 * state; none names another organization. A database failure is
 * `DomainsUnavailable`, never a fall-through to an empty "Start" screen (which
 * would invite a claim against a database that is down).
 *
 * `OrgAccessError` is RE-THROWN so `[slug]/error.tsx` shows its own copy.
 *
 * NO `loading.tsx` HERE: this segment's page calls `notFound()` and `redirect()`
 * (CLAUDE.md -> The (org) contract), and a Suspense boundary above it would turn
 * the 404 into a 200.
 */
export default async function DomainsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/domains`)}`);
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  switch (resolved.kind) {
    case "not-found":
      notFound();
    case "forbidden":
      return (
        <OrgAccessDenied name={resolved.name} organizationType={resolved.organizationType} slug={slug} />
      );
    case "ended":
      return <OrgAccessEnded name={resolved.name} endedOn={resolved.endedOn} slug={slug} />;
    case "ok":
      break;
  }

  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const siteAddress = platformSiteAddress(slug);
  let view;
  try {
    view = await readDomainsView(resolved.org.personId, resolved.org.organizationId, {
      platformSiteUrl: siteAddress,
    });
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <DomainsUnavailable slug={slug} />;
  }

  if (view.kind === "feature_off") return <DomainsFeatureOff name={resolved.org.name} />;
  if (view.kind === "forbidden") return <DomainsForbidden name={resolved.org.name} />;

  const { groups, activity } = view;
  const advisory = primaryAdvisory(groups);
  const supportHref = `/o/${slug}/tickets/new`;

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Website domain</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect {resolved.org.name}&apos;s own web address to its public site.
        </p>
      </div>

      {groups.length === 0 ? (
        <DomainsEmpty slug={slug} siteAddress={siteAddress} />
      ) : (
        <>
          {advisory && <PrimaryAdvisoryBanner slug={slug} advisory={advisory} />}

          {groups.map((group, i) => (
            <DomainClaimCard
              key={group.claimName}
              group={group}
              idPrefix={`claim-${i}`}
              supportHref={supportHref}
              actions={<GroupActions slug={slug} group={group} groups={groups} />}
              hostActions={(host) =>
                group.purpose === "web" && host.role === "alias" && host.state === "live" && host.hold === null ? (
                  <CanonicalDialog slug={slug} domainId={host.id} hostname={host.displayHostname} />
                ) : null
              }
            />
          ))}

          <section aria-labelledby="domains-add" className="space-y-3">
            <h2 id="domains-add" className="text-xl font-semibold">
              Add another domain
            </h2>
            <ClaimForm slug={slug} submitLabel="Add domain" idPrefix="claim-more" />
          </section>

          <ActivityList items={activity} />
        </>
      )}
    </div>
  );
}

function GroupActions({
  slug,
  group,
  groups,
}: {
  slug: string;
  group: ChecklistGroup;
  groups: readonly ChecklistGroup[];
}) {
  const holdsPrimary = group.hosts.some((h) => h.role === "canonical");
  const replacements: RemoveReplacement[] = holdsPrimary
    ? groups
        .filter((g) => g.claimName !== group.claimName && g.purpose === "web")
        .flatMap((g) => g.hosts)
        .filter((h) => h.state === "live" && h.hold === null)
        .map((h) => ({ id: h.id, displayHostname: h.displayHostname }))
    : [];
  return (
    <>
      {group.canCheck && <CheckNowButton slug={slug} claimName={group.claimName} />}
      {group.canReconnect && <ReconnectButton slug={slug} claimName={group.claimName} />}
      {group.canRemove && (
        <RemoveDialog
          slug={slug}
          claimName={group.claimName}
          displayName={group.displayName}
          wasConnected={group.phase !== "proving"}
          replacements={replacements}
        />
      )}
    </>
  );
}
