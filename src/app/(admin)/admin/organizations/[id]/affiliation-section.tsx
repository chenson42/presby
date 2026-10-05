import Link from "next/link";
import { FormattedDate } from "@/components/shared/formatted-date";
import { organizationTypeLabel, relationshipTypeLabel } from "@/lib/org-display";
import type { OrganizationAffiliationAdminDetail } from "@/lib/org-provisioning";

/**
 * "Council affiliation" — read-only section on `/admin/organizations/<id>`
 * (docs/work-log/2026-09-28-organization-parent-picker.md Phase 3). Names the
 * organization's OPEN affiliation row and links to the parent's own detail
 * page (the org tree is public, DECISION-040). There is deliberately no
 * control here: setting or changing a parent after creation is a council act
 * (`presby_transfer_affiliation()`), and the platform is not a council — Two
 * Hierarchies.
 *
 * Always renders. A headless organization (a root presbytery or synod) gets
 * explicit copy rather than a vanished section.
 *
 * Plain server-renderable: no state, no form. (`FormattedDate` is the one
 * client island, for the effective date.)
 */
export function AffiliationSection({
  affiliation,
}: {
  affiliation: OrganizationAffiliationAdminDetail;
}) {
  return (
    <section className="mt-8" aria-labelledby="council-affiliation-heading">
      <h2
        id="council-affiliation-heading"
        className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
      >
        Council affiliation
      </h2>
      {affiliation === null ? (
        <p className="mt-1 text-sm text-muted-foreground">
          This organization has no recorded parent council.
        </p>
      ) : (
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">Parent</dt>
          <dd className="min-w-0 break-words">
            <Link
              href={`/admin/organizations/${affiliation.parent.id}`}
              className="underline"
            >
              {affiliation.parent.name}
            </Link>{" "}
            <span className="text-muted-foreground">
              ({organizationTypeLabel(affiliation.parent.organizationType)})
            </span>
          </dd>
          <dt className="text-muted-foreground">Relationship</dt>
          <dd>{relationshipTypeLabel(affiliation.relationshipType)}</dd>
          <dt className="text-muted-foreground">Effective</dt>
          <dd>
            {affiliation.effectiveFrom ? (
              <FormattedDate value={affiliation.effectiveFrom} mode="date" />
            ) : (
              "Predates our records"
            )}
          </dd>
          <dt className="text-muted-foreground">Record</dt>
          <dd className="min-w-0 break-words">
            {affiliation.authority === "recorded"
              ? "Minuted"
              : "Backfilled (no minute on file)"}
            {affiliation.minuteReference ? (
              <>
                {" "}
                — <span>{affiliation.minuteReference}</span>
              </>
            ) : null}
          </dd>
        </dl>
      )}
    </section>
  );
}
