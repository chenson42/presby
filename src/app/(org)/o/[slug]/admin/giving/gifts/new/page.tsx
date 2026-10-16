import Link from "next/link";
import { OrgAccessError } from "@/lib/authz";
import { listFundOptions, type FundOption } from "@/lib/giving/funds";
import { getRecordingDefaults, listRecentOwnEntries, type OwnEntryRow } from "@/lib/giving/gifts";
import { GivingBackLink, GivingLoadError } from "../../giving-admin-states";
import { gateGivingPage } from "../../giving-page-gate";
import { RecentEntries } from "../recent-entries";
import { OfflineGiftForm } from "./offline-gift-form";

/**
 * `/o/<slug>/admin/giving/gifts/new` - record an offline gift, `giving.record`.
 * docs/work-log/2026-10-15-online-giving.md, Flow 8 and the S4 scope: the
 * recorder reads the active fund list, the donor picker (through the form) and
 * their OWN recent entries - never the ledger.
 *
 * Gate: `gateGivingPage` (sign-in -> four-way org miss -> 2FA -> toggle ->
 * `giving.record`). States: forbidden/off (gate), load error, "no funds yet"
 * (nothing can be recorded against no fund; the treasurer is pointed at Funds),
 * and the form. No `loading.tsx`.
 */
export default async function NewGiftPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/admin/giving/gifts/new`;
  const gate = await gateGivingPage({ slug, path, anyOf: ["record"], section: "Record a gift" });
  if (!gate.ok) return gate.node;

  let funds: FundOption[] = [];
  let today = "";
  let entries: OwnEntryRow[] = [];
  let failed = false;
  try {
    const [fundResult, defaults, recent] = await Promise.all([
      listFundOptions(gate.org.personId, gate.org.organizationId),
      getRecordingDefaults(gate.org.personId, gate.org.organizationId),
      listRecentOwnEntries(gate.org.personId, gate.org.organizationId, gate.userId),
    ]);
    if (fundResult.kind !== "ok" || defaults.kind !== "ok" || recent.kind !== "ok") {
      failed = true;
    } else {
      funds = fundResult.funds;
      today = defaults.today;
      entries = recent.entries;
    }
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    failed = true;
  }
  if (failed) return <GivingLoadError slug={slug} href={path} />;

  return (
    <div className="max-w-2xl space-y-8">
      <GivingBackLink slug={slug} />
      <div>
        <h1 className="text-2xl font-semibold">Record a gift</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          For cash, check, stock and other gifts that arrived by hand at {gate.org.name}.
        </p>
      </div>

      {funds.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm font-medium">There are no funds to record against yet</p>
          <p className="mx-auto mt-1 max-w-md px-4 text-sm text-muted-foreground">
            {gate.has.manage
              ? "Add a fund first, then come back to record the gift."
              : "Ask your treasurer to add a fund, then come back to record the gift."}
          </p>
          {gate.has.manage && (
            <Link
              href={`/o/${slug}/admin/giving/funds`}
              className="mt-4 inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Go to Funds
            </Link>
          )}
        </div>
      ) : (
        // HydrationGate carries `m-0`, which would cancel this stack's `space-y-8`
        // gap above and below it; a plain wrapper keeps the spacing.
        <div>
          <OfflineGiftForm slug={slug} funds={funds} today={today} />
        </div>
      )}

      <section aria-labelledby="gift-recent" className="space-y-3">
        <h2 id="gift-recent" className="text-xl font-semibold">
          Your recent entries
        </h2>
        <RecentEntries slug={slug} entries={entries} canRecord={false} />
      </section>
    </div>
  );
}
