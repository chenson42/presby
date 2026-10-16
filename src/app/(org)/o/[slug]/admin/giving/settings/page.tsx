import { OrgAccessError } from "@/lib/authz";
import { getGivingSettings, type GetGivingSettingsResult } from "@/lib/giving/settings";
import { Card, CardContent } from "@/components/ui/card";
import { GivingBackLink, GivingLoadError } from "../giving-admin-states";
import { gateGivingPage } from "../giving-page-gate";
import { SettingsForm } from "./settings-form";

/**
 * `/o/<slug>/admin/giving/settings` - the donee identity printed on year-end
 * statements (`giving.manage`). docs/work-log/2026-10-15-online-giving.md,
 * R5 / DECISION-172 and Phase 3 "Pages to create".
 *
 * Shows what blocks a statement run, in words: a missing legal name or mailing
 * address. Statements snapshot these values when issued, so changing them here
 * never rewrites a statement already sent - the page says so. Card/ACH fee
 * rates arrive with the Stripe connection (Batch 3). No `loading.tsx`.
 */
export default async function GivingSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/admin/giving/settings`;
  const gate = await gateGivingPage({ slug, path, anyOf: ["manage"], section: "Statement details" });
  if (!gate.ok) return gate.node;

  let result: GetGivingSettingsResult;
  try {
    result = await getGivingSettings(gate.org.personId, gate.org.organizationId);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <GivingLoadError slug={slug} href={path} />;
  }
  if (result.kind !== "ok") return <GivingLoadError slug={slug} href={path} />;

  return (
    <div className="max-w-2xl space-y-8">
      <GivingBackLink slug={slug} />
      <div>
        <h1 className="text-2xl font-semibold">Statement details</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What {gate.org.name} prints on year-end giving statements. A statement keeps the details it
          was issued with, so changing them later doesn&apos;t alter statements already sent.
        </p>
      </div>

      {result.blockers.length > 0 ? (
        <div role="status" className="rounded-lg border border-border bg-muted p-4 text-sm" data-testid="statement-blockers">
          <p className="font-medium">Statements can&apos;t be issued yet. Still needed:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {result.blockers.includes("donee_name") && <li>The legal name of the church</li>}
            {result.blockers.includes("donee_address") && (
              <li>A complete mailing address (street, city, state and ZIP)</li>
            )}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="statement-ready">
          The church&apos;s name and address are complete.
        </p>
      )}

      <Card>
        <CardContent>
          <SettingsForm slug={slug} initial={result.settings} />
        </CardContent>
      </Card>
    </div>
  );
}
