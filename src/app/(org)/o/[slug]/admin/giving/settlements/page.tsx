import { OrgAccessError } from "@/lib/authz";
import { SETTLEMENTS_COPY } from "@/lib/giving/giving-copy";
import { listSettlements, type ListSettlementsResult } from "@/lib/giving/settlements";
import { GivingBackLink, GivingLoadError } from "../giving-admin-states";
import { gateGivingPage } from "../giving-page-gate";
import { SettlementsList } from "./settlements-list";

/**
 * `/o/<slug>/admin/giving/settlements` - what Stripe has paid out, and what each
 * deposit contained (`giving.view`). docs/work-log/2026-10-15-online-giving.md,
 * Phase 3 "Settlements" and Batch 6 (droppable). READ-ONLY: this page has no
 * action and the tenant connection holds no write privilege on the tables.
 *
 * Four states, designed: forbidden / toggle-off (the gate's), a load error
 * (never an empty list: "We can't load Giving right now"), empty (no payout has
 * been reported yet) and populated. No `loading.tsx` (a segment that can
 * redirect).
 */

export default async function GivingSettlementsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/admin/giving/settlements`;
  const gate = await gateGivingPage({ slug, path, anyOf: ["view"], section: SETTLEMENTS_COPY.heading });
  if (!gate.ok) return gate.node;

  let result: ListSettlementsResult;
  try {
    result = await listSettlements(gate.org.personId, gate.org.organizationId);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <GivingLoadError slug={slug} href={path} />;
  }
  if (result.kind !== "ok") return <GivingLoadError slug={slug} href={path} />;

  return (
    <div className="max-w-4xl space-y-6">
      <GivingBackLink slug={slug} />
      <div>
        <h1 className="text-2xl font-semibold">{SETTLEMENTS_COPY.heading}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{SETTLEMENTS_COPY.intro(gate.org.name)}</p>
      </div>

      {result.settlements.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center" data-testid="settlements-empty">
          <p className="text-sm font-medium">{SETTLEMENTS_COPY.emptyTitle}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{SETTLEMENTS_COPY.emptyBody}</p>
        </div>
      ) : (
        <>
          <SettlementsList settlements={result.settlements} />
          {result.truncated && (
            <p className="text-sm text-muted-foreground" data-testid="settlements-truncated">
              {SETTLEMENTS_COPY.truncated(result.settlements.length)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
