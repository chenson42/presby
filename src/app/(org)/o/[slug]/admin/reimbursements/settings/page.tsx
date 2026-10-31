import { OrgAccessError } from "@/lib/authz";
import { COPY } from "@/lib/reimbursement/copy";
import { gateReimbursementPage } from "@/lib/reimbursement/gate";
import { getSettings } from "@/lib/reimbursement/reads";
import { BackToReimbursements, ReimbursementLoadError, ReimbursementStatePage } from "../../../reimbursements/reimbursement-states";
import { CategoriesPanel } from "./categories-panel";
import { ChargeableGroups } from "./chargeable-groups";

/**
 * `/o/<slug>/admin/reimbursements/settings` - which groups can receive requests
 * and the categories (`reimbursement.manage`). docs/work-log/2026-10-25-treasury-
 * inc1.md, Phase 3 "Component / Page Plan" and Copy C9.
 *
 * Four states: forbidden / off / not applicable (the gate), a load error (never an
 * empty list, which would read as "no groups"), the empty note when no group can
 * receive requests yet (`No group can receive requests yet. Choose at least one so
 * people can make requests.`), and the populated page. Read-only on load. No
 * `loading.tsx`.
 */
export default async function ReimbursementSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/admin/reimbursements/settings`;
  const gate = await gateReimbursementPage({ slug, path, anyOf: ["manage"] });
  if (!gate.ok) {
    return (
      <ReimbursementStatePage
        state={gate.state}
        slug={slug}
        heading={COPY.settings.heading}
        retryHref={path}
        loadErrorMessage={COPY.queue.loadError}
      />
    );
  }

  let result: Awaited<ReturnType<typeof getSettings>>;
  try {
    result = await getSettings(gate.identity);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <ReimbursementLoadError heading={COPY.settings.heading} message={COPY.queue.loadError} href={path} />;
  }
  if (result.kind !== "ok") {
    return <ReimbursementLoadError heading={COPY.settings.heading} message={COPY.queue.loadError} href={path} />;
  }
  const { groups, categories } = result.settings;

  return (
    <div className="max-w-2xl space-y-8">
      <BackToReimbursements slug={slug} href={`/o/${slug}/admin/reimbursements`} />
      <h1 className="text-2xl font-semibold">{COPY.settings.heading}</h1>

      <section aria-labelledby="groups-heading" className="space-y-3">
        <h2 id="groups-heading" className="text-xl font-semibold">
          {COPY.settings.groupsHeading}
        </h2>
        {!groups.some((group) => group.chargeable) && (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-base text-muted-foreground" data-testid="no-chargeable-groups">
            {COPY.settings.noGroups}
          </p>
        )}
        <ChargeableGroups slug={slug} groups={groups} />
      </section>

      <section aria-labelledby="categories-heading" className="space-y-3">
        <h2 id="categories-heading" className="text-xl font-semibold">
          {COPY.settings.categoriesHeading}
        </h2>
        <CategoriesPanel slug={slug} categories={categories} />
      </section>
    </div>
  );
}
