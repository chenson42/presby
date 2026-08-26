/**
 * The one non-data-bearing answer `/o/<slug>/admin` can give (the other
 * three — not-found/forbidden/ended — are handled one level up by
 * `../org-states.tsx`, reused as-is). Modeled on `admin/features/
 * features-states.tsx`'s `FeaturesFlagOff` — same one-block structure and
 * copy register (portal-reorg pipeline, docs/work-log/
 * 2026-08-26-portal-reorg-and-modernization.md, Phase 3).
 */

/** `org_portal.admin_hub` is off. A product-not-here message, not a denial. */
export function AdminHubFlagOff({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Organization Administration</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Organization administration isn&apos;t turned on for {name} yet.
      </p>
    </section>
  );
}
