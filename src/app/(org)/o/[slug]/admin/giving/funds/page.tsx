import { OrgAccessError } from "@/lib/authz";
import { listFunds, type FundRow, type ListFundsResult } from "@/lib/giving/funds";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { RESTRICTION_LABELS } from "@/lib/giving/fund-input";
import { FormattedDate } from "@/components/shared/formatted-date";
import { GivingBackLink, GivingLoadError } from "../giving-admin-states";
import { gateGivingPage } from "../giving-page-gate";
import { CreateGeneralFundButton } from "./create-general-fund-button";
import { FundForm } from "./fund-form";
import { FundRowActions } from "./fund-row-actions";

/**
 * `/o/<slug>/admin/giving/funds` - funds (designations), `giving.manage`.
 * docs/work-log/2026-10-15-online-giving.md, Phase 3 "Pages to create" and G23.
 *
 * Gate: `gateGivingPage` (sign-in -> four-way org miss -> 2FA -> toggle ->
 * `giving.manage`). Four states: forbidden/off (from the gate), load error
 * (a database failure is never an empty list), empty (one-click "Create General
 * Fund"), populated. A retired fund keeps its row (a fund with gifts is never
 * deleted) under its own heading. No `loading.tsx`.
 */
export default async function GivingFundsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gate = await gateGivingPage({
    slug,
    path: `/o/${slug}/admin/giving/funds`,
    anyOf: ["manage"],
    section: "Funds",
  });
  if (!gate.ok) return gate.node;

  let result: ListFundsResult;
  try {
    result = await listFunds(gate.org.personId, gate.org.organizationId);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <GivingLoadError slug={slug} href={`/o/${slug}/admin/giving/funds`} />;
  }
  if (result.kind === "forbidden") {
    return <GivingLoadError slug={slug} href={`/o/${slug}/admin/giving/funds`} />;
  }

  const active = result.funds.filter((f) => f.isActive);
  const retired = result.funds.filter((f) => !f.isActive);

  return (
    <div className="max-w-3xl space-y-8">
      <GivingBackLink slug={slug} />
      <div>
        <h1 className="text-2xl font-semibold">Funds</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The designations gifts can go to at {gate.org.name}. A fund with gifts is retired, never deleted.
        </p>
      </div>

      {result.funds.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm font-medium">No funds yet</p>
          <p className="mx-auto mt-1 max-w-md px-4 text-sm text-muted-foreground">
            Every gift is recorded against a fund. Most congregations start with a General Fund.
          </p>
          <CreateGeneralFundButton slug={slug} />
        </div>
      ) : (
        <section aria-labelledby="funds-active" className="space-y-3">
          <h2 id="funds-active" className="text-xl font-semibold">
            Active funds
          </h2>
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every fund is retired. Reactivate one below, or add a new fund.
            </p>
          ) : (
            <ul className="space-y-3">
              {active.map((fund) => (
                <FundCard key={fund.id} slug={slug} fund={fund} />
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="funds-add" className="space-y-3">
        <h2 id="funds-add" className="text-xl font-semibold">
          Add a fund
        </h2>
        <Card>
          <CardContent>
            <FundForm slug={slug} />
          </CardContent>
        </Card>
      </section>

      {retired.length > 0 && (
        <section aria-labelledby="funds-retired" className="space-y-3">
          <h2 id="funds-retired" className="text-xl font-semibold">
            Retired funds
          </h2>
          <ul className="space-y-3">
            {retired.map((fund) => (
              <FundCard key={fund.id} slug={slug} fund={fund} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function FundCard({ slug, fund }: { slug: string; fund: FundRow }) {
  return (
    <li>
      <Card>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-medium">{fund.name}</h3>
              <Badge variant="outline">{RESTRICTION_LABELS[fund.restrictionClass]}</Badge>
              {fund.offeredOnline && <Badge variant="secondary">Offered online</Badge>}
              {!fund.isActive && <Badge variant="secondary">Retired</Badge>}
            </div>
            {fund.offeredOnline && fund.onlineDisplayName && (
              <p className="text-sm text-muted-foreground">Donors see: {fund.onlineDisplayName}</p>
            )}
            {fund.description && <p className="text-sm text-muted-foreground">{fund.description}</p>}
            {fund.retiredOn && (
              <p className="text-sm text-muted-foreground">
                Retired <FormattedDate value={fund.retiredOn} mode="date" />
              </p>
            )}
          </div>
          <FundRowActions slug={slug} fund={fund} />
        </CardContent>
      </Card>
    </li>
  );
}
