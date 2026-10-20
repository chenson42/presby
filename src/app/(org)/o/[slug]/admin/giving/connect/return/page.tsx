import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { OrgAccessError } from "@/lib/authz";
import {
  loadConnectionPanel,
  refreshConnection,
  type ConnectionPanel,
  type RefreshConnectionResult,
} from "@/lib/giving/connection";
import { deriveDisplayState } from "@/lib/giving/connection-display";
import { RETURN_RESULT, UNCONFIGURED_MESSAGE } from "@/lib/giving/giving-copy";
import { ConnectionCard } from "../../connection-card";
import { GivingBackLink, GivingLoadError } from "../../giving-admin-states";
import { gateGivingPage } from "../../giving-page-gate";

/**
 * `GET /o/<slug>/admin/giving/connect/return` - where Stripe sends the
 * treasurer when onboarding ends (docs/work-log/2026-10-15-online-giving.md,
 * Phase 3 "Admin - connection" and Batch 3b).
 *
 * THE URL PROVES NOTHING. Anyone can open this address without having
 * onboarded, and nothing in the query string is read. The page RETRIEVES the
 * account from Stripe (`refreshConnection`), lets the database map it to a
 * status, and then renders what is true - the same card the overview shows -
 * under a one-line result. A status change is audited inside
 * `refreshConnection` (a page has no action to audit from).
 *
 * Gate: the shared `gateGivingPage()` with `giving.manage`, so signed-out,
 * 2FA, the four-way org miss, the toggle and the key behave exactly as on every
 * other giving page. NO `loading.tsx` (CLAUDE.md, "The (org) contract"): this
 * segment can redirect or 404, and the retrieve is the page's whole job.
 */

export const dynamic = "force-dynamic";

function resultLine(result: RefreshConnectionResult, panel: ConnectionPanel | null): string {
  switch (result.kind) {
    case "ok": {
      return panel ? RETURN_RESULT[deriveDisplayState(panel)] : "We checked with Stripe.";
    }
    case "provider_error":
      return "We couldn't reach Stripe to check your account just now, so nothing was changed. Showing what we last knew.";
    case "stripe_unconfigured":
      return UNCONFIGURED_MESSAGE;
    case "no_connection":
      return "There's no Stripe connection to check yet. You can start one below.";
    case "forbidden":
      return "You don't have permission to manage the Stripe connection here.";
  }
}

export default async function ConnectReturnPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/admin/giving/connect/return`;

  const gate = await gateGivingPage({ slug, path, anyOf: ["manage"], section: "Stripe connection" });
  if (!gate.ok) return gate.node;

  let result: RefreshConnectionResult;
  let panel: ConnectionPanel | null = null;
  try {
    result = await refreshConnection({
      personId: gate.org.personId,
      organizationId: gate.org.organizationId,
      userId: gate.userId,
    });
    const loaded = await loadConnectionPanel(gate.org.personId, gate.org.organizationId);
    if (loaded.kind === "ok") panel = loaded.panel;
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <GivingLoadError slug={slug} href={path} />;
  }

  const problem = result.kind !== "ok";

  return (
    <div className="max-w-2xl space-y-6">
      <GivingBackLink slug={slug} />
      <div>
        <h1 className="text-2xl font-semibold">Stripe connection</h1>
        <p className="mt-1 text-sm text-muted-foreground">{gate.org.name}</p>
      </div>

      <div
        role="status"
        data-testid="connect-return-result"
        className="flex items-start gap-3 rounded-lg border border-border bg-muted p-4"
      >
        {problem && <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />}
        <p className="text-sm">{resultLine(result, panel)}</p>
      </div>

      {panel ? (
        <ConnectionCard slug={slug} panel={panel} />
      ) : (
        <p className="text-sm text-muted-foreground">
          We can&apos;t show the connection card right now.{" "}
          <Link href={path} className="underline">
            Try again
          </Link>
        </p>
      )}
    </div>
  );
}
