import Link from "next/link";
import { DomainClaimCard } from "@/components/shared/domain-claim-card";
import { FormattedDate } from "@/components/shared/formatted-date";
import { primaryAdvisory } from "@/lib/domains/checklist";
import type { OrgDomainsForPlatform } from "@/lib/domains/platform-read";
import { DomainTogglesCard } from "./domain-toggles-card";
import { PlatformClaimForm } from "./platform-claim-form";
import { PlatformDomainActions } from "./platform-domain-actions";

/**
 * The Domains section on `/admin/organizations/<id>` (Flow 7, G31). Shows
 * exactly what the church sees (the same claim cards, the same records and
 * banners) plus what support needs: last-checked time, the last check's error
 * class, claim age, and the platform controls per host. Platform palette, no
 * brand. The platform admin never sees or controls the church's DNS credentials
 * and gains no tenant authority: the claim here is web-only and still needs the
 * DNS proof.
 *
 * Server component; the interactive bits (toggles, per-host dialogs, the claim
 * form) are the client islands imported above.
 */

const CHECK_CLASS_LABELS: Record<string, string> = {
  ok: "Healthy",
  dns_unknown: "DNS lookup failed",
  provider_unavailable: "Hosting provider unavailable",
  config_error: "Platform hosting misconfigured",
  held_elsewhere: "Held by another organization",
  provider_rejected: "Hosting provider refused the name",
  rate_limited: "Rate limited",
};

export function DomainsSection({
  organizationId,
  organizationName,
  data,
}: {
  organizationId: string;
  organizationName: string;
  data: OrgDomainsForPlatform;
}) {
  const { groups, toggles, history, siteStatus, daysInState } = data;
  const advisory = primaryAdvisory(groups);
  const websiteOn = toggles["org_portal.domains"] === true;
  return (
    <section className="mt-10" aria-labelledby="org-domains" data-testid="domains-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="org-domains" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Domains
        </h2>
        <Link href="/admin/organizations/domains" className="text-sm underline underline-offset-4">
          All domains
        </Link>
      </div>

      <div className="mt-3 space-y-6">
        <DomainTogglesCard organizationId={organizationId} organizationName={organizationName} initial={toggles} />

        {!websiteOn && (
          <p className="text-sm text-muted-foreground">
            Website domains are off for {organizationName}. They can&apos;t add or serve a domain until you turn them
            on.
          </p>
        )}
        {siteStatus !== null && siteStatus !== "live" && (
          <p className="text-sm text-muted-foreground">
            The organization&apos;s public site is {siteStatus}, so a custom host would not serve it yet.
          </p>
        )}
        {advisory && (
          <p data-testid="platform-primary-advisory" className="rounded-md border border-foreground/50 p-3 text-sm">
            The primary address {advisory.primary.displayHostname} isn&apos;t serving while {advisory.candidate.displayHostname}{" "}
            is live. The church can make {advisory.candidate.displayHostname} primary from its own Domains page.
          </p>
        )}

        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {organizationName} has no domains. Record a claim on its behalf below, or the church can start one itself
            from its admin page.
          </p>
        ) : (
          groups.map((group, i) => (
            <div key={group.claimName} className="space-y-3">
              <DomainClaimCard
                group={group}
                idPrefix={`platform-claim-${i}`}
                showCopyAll={false}
                hostActions={(host) => (
                  <div className="space-y-2">
                    <PlatformDomainActions host={host} organizationName={organizationName} />
                  </div>
                )}
              />
              <dl
                data-testid="platform-support-facts"
                className="grid gap-x-6 gap-y-1 rounded-md border border-border p-3 text-sm sm:grid-cols-2"
              >
                {group.hosts.map((h) => {
                  const age = daysInState[h.id] ?? null;
                  return (
                    <div key={h.id} className="contents">
                      <dt className="break-all font-medium">{h.displayHostname}</dt>
                      <dd className="text-muted-foreground">
                        {h.lastCheckClass ? (CHECK_CLASS_LABELS[h.lastCheckClass] ?? h.lastCheckClass) : "Not checked yet"}
                        {h.lastCheckedAt && (
                          <>
                            {" · checked "}
                            <FormattedDate value={h.lastCheckedAt} />
                          </>
                        )}
                        {age !== null && ` · ${age} day${age === 1 ? "" : "s"} in this state`}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          ))
        )}

        {history.length > 0 && (
          <div>
            <h3 className="text-base font-semibold">Released and expired</h3>
            <ul className="mt-2 divide-y divide-border rounded-md border border-border text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                  <span className="break-all">{h.hostname}</span>
                  <span className="text-muted-foreground">
                    {h.state === "expired" ? "Expired" : `Released${h.releaseCause ? ` (${h.releaseCause.replace(/_/g, " ")})` : ""}`}
                    {" · "}
                    <FormattedDate value={h.at} mode="date" />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {websiteOn && (
          <div>
            <h3 className="text-base font-semibold">Record a claim on this organization&apos;s behalf</h3>
            <p className="mb-3 mt-1 text-sm text-muted-foreground">
              The church still has to publish the ownership record before anything is connected.
            </p>
            <PlatformClaimForm organizationId={organizationId} organizationName={organizationName} />
          </div>
        )}
      </div>
    </section>
  );
}
