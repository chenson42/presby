import Link from "next/link";
import { Download } from "lucide-react";
import { OrgAccessError } from "@/lib/authz";
import { parseGiftFilters } from "@/lib/giving/gift-input";
import { listFundOptions, type FundOption } from "@/lib/giving/funds";
import {
  listGifts,
  listRecentOwnEntries,
  type ListGiftsResult,
  type OwnEntryRow,
} from "@/lib/giving/gifts";
import { Button } from "@/components/ui/button";
import { GivingBackLink, GivingLoadError } from "../giving-admin-states";
import { gateGivingPage } from "../giving-page-gate";
import { GiftFilterForm, giftQuery } from "./gift-filters";
import { GiftsList } from "./gifts-list";
import { RecentEntries } from "./recent-entries";

/**
 * `/o/<slug>/admin/giving/gifts` - the gift ledger (`giving.view`), or, for a
 * `giving.record` holder WITHOUT `giving.view`, the recent-own-entries variant
 * (S4, P3-4): their own last 30 days and nothing else. docs/work-log/
 * 2026-10-15-online-giving.md, Phase 3 "Pages to create".
 *
 * The two variants are chosen by the viewer's keys, and the recorder branch
 * never calls `listGifts` (which would refuse them anyway). Filters and the
 * keyset cursor live in the URL (`?from&to&fund&status&source&donor&cursor`);
 * the CSV link carries the same filters. Four states: forbidden/off (gate),
 * load error, empty (with the action that fills it), populated. No `loading.tsx`.
 */
export default async function GivingGiftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const raw = await searchParams;
  const path = `/o/${slug}/admin/giving/gifts`;
  const gate = await gateGivingPage({ slug, path, anyOf: ["view", "record"], section: "Gifts" });
  if (!gate.ok) return gate.node;

  // ---- recorder variant (S4): own entries only ---------------------------
  if (!gate.has.view) {
    let entries: OwnEntryRow[] = [];
    let recentFailed = false;
    try {
      const recent = await listRecentOwnEntries(gate.org.personId, gate.org.organizationId, gate.userId);
      if (recent.kind === "ok") entries = recent.entries;
      else recentFailed = true;
    } catch (err) {
      if (err instanceof OrgAccessError) throw err;
      recentFailed = true;
    }
    if (recentFailed) return <GivingLoadError slug={slug} href={path} />;
    return (
      <div className="max-w-2xl space-y-6">
        <GivingBackLink slug={slug} />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Your recent entries</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              The gifts you recorded at {gate.org.name} in the last 30 days.
            </p>
          </div>
          <Button asChild className="min-h-11">
            <Link href={`${path}/new`}>Record a gift</Link>
          </Button>
        </div>
        <RecentEntries slug={slug} entries={entries} canRecord />
      </div>
    );
  }

  // ---- ledger variant ------------------------------------------------------
  const filters = parseGiftFilters(raw);
  const cursor = typeof raw.cursor === "string" ? raw.cursor : undefined;

  let result: ListGiftsResult | null = null;
  let funds: FundOption[] = [];
  try {
    const [giftsResult, fundsResult] = await Promise.all([
      listGifts(gate.org.personId, gate.org.organizationId, { filters, cursor }),
      listFundOptions(gate.org.personId, gate.org.organizationId, { includeRetired: true }),
    ]);
    if (giftsResult.kind === "ok" && fundsResult.kind === "ok") {
      result = giftsResult;
      funds = fundsResult.funds;
    }
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
  }
  if (!result || result.kind !== "ok") return <GivingLoadError slug={slug} href={path} />;

  const filtered = Object.keys(filters).length > 0;

  return (
    <div className="max-w-3xl space-y-6">
      <GivingBackLink slug={slug} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Gifts</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every gift to {gate.org.name}, newest first.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {gate.has.record && (
            <Button asChild className="min-h-11">
              <Link href={`${path}/new`}>Record a gift</Link>
            </Button>
          )}
          <Button asChild variant="outline" className="min-h-11">
            <a href={`${path}/export${giftQuery(filters)}`} download>
              <Download className="size-4" aria-hidden />
              Download CSV
            </a>
          </Button>
        </div>
      </div>

      <GiftFilterForm slug={slug} funds={funds} filters={filters} />

      {result.gifts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm font-medium">{filtered ? "No gifts match those filters" : "No gifts recorded yet"}</p>
          <p className="mx-auto mt-1 max-w-md px-4 text-sm text-muted-foreground">
            {filtered
              ? "Try a wider date range, or clear the filters."
              : "Gifts appear here as they are recorded by hand or arrive online."}
          </p>
          {!filtered && gate.has.record && (
            <Button asChild className="mt-4 min-h-11">
              <Link href={`${path}/new`}>Record a gift</Link>
            </Button>
          )}
        </div>
      ) : (
        <GiftsList slug={slug} gifts={result.gifts} />
      )}

      {result.nextCursor && (
        <div className="flex justify-center">
          <Button asChild variant="outline" className="min-h-11">
            <Link href={`${path}${giftQuery(filters, result.nextCursor)}`}>Show older gifts</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
