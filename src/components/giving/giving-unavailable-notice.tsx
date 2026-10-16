import { ContactLine } from "@/components/giving/contact-line";
import { GIVING_UNAVAILABLE } from "@/lib/giving/giving-copy";

/**
 * "Online giving isn't available right now" - docs/work-log/2026-10-15-online-
 * giving.md, Flow 3 ("Connection inactive") and the page-state machine. Shared
 * by the `/site/<slug>/give` page, the signed-in member page and the `giving`
 * live slot, so a donor reads one sentence wherever they land.
 *
 * Rendered ONLY for an organization the visitor can already see is a tenant with
 * a live public site (or a signed-in member of it); the `absent` case never gets
 * here - it is a plain 404 that tells a prober nothing. Names the congregation
 * and, if the public profile has one, its phone so a donor has another way to
 * give. A server component with no data of its own and no hooks, so it is safe
 * inside the live slot (no heading level of its own beyond `h2`).
 */

export function GivingUnavailableNotice({
  organizationName,
  contactPhone,
  headingLevel = 1,
}: {
  organizationName: string;
  contactPhone: string | null;
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section data-testid="giving-unavailable" aria-labelledby="giving-unavailable-heading" className="space-y-3">
      <Heading id="giving-unavailable-heading" className={headingLevel === 1 ? "text-2xl font-semibold" : "text-xl font-semibold"}>
        {GIVING_UNAVAILABLE.heading}
      </Heading>
      <p className="text-base text-muted-foreground">
        {organizationName} isn&apos;t taking online gifts at the moment. {GIVING_UNAVAILABLE.body}
      </p>
      <ContactLine phone={contactPhone} />
    </section>
  );
}
