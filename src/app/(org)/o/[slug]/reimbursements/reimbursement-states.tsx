import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COPY } from "@/lib/reimbursement/copy";
import type { ReimbursementGateState } from "@/lib/reimbursement/gate";
import { OrgAccessDenied, OrgAccessEnded } from "../org-states";

/**
 * The non-data answers a reimbursement page can give - docs/work-log/
 * 2026-10-25-treasury-inc1.md, Phase 3 Copy C2 and C7, and the gate order in
 * "Permissions & Flags". One renderer for every `ReimbursementGateState` so the
 * member pages here and the treasurer pages (Batch 6) say the same thing the
 * same way:
 *
 *   - `org_forbidden` / `org_ended`: the (org) tree's own byte-identical
 *     answers (DECISION-040), reused as they are.
 *   - `not_applicable`, `toggle_off`, `forbidden`, `load_error`: honest pages at
 *     HTTP 200. The viewer is a member and already knows the organization
 *     exists; none of them is a 404 (a 404 would hide that Reimbursements
 *     exists and strand a treasurer who typed the right URL on the wrong day).
 *
 * `toggle_off` shows the Features link only when the viewer can use it
 * (`canManageFeatures`, read in the same transaction as the toggle). A database
 * blip is `load_error`, never "off" and never "not allowed".
 *
 * Server components, no hooks, no tenant data: all of these are reachable by a
 * member who holds no reimbursement key.
 */

/** "You can turn them on under Features." with "Features" as the link. */
function ToggleOffManageLine({ slug }: { slug: string }) {
  const [before = "", after = ""] = COPY.page.toggleOffCanManage.split("Features");
  return (
    <>
      {before}
      <Link
        href={`/o/${slug}/admin/features`}
        className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Features
      </Link>
      {after}
    </>
  );
}

export function ReimbursementStatePage({
  state,
  slug,
  heading = COPY.page.heading,
  retryHref,
}: {
  state: ReimbursementGateState;
  slug: string;
  heading?: string;
  /** Where "Try again" goes for `load_error`; defaults to the member list. */
  retryHref?: string;
}) {
  switch (state.kind) {
    case "org_forbidden":
      return <OrgAccessDenied name={state.name} organizationType={state.organizationType} slug={slug} />;
    case "org_ended":
      return <OrgAccessEnded name={state.name} endedOn={state.endedOn} slug={slug} />;
    case "not_applicable":
      return (
        <section className="max-w-2xl" data-testid="reimbursement-not-applicable">
          <h1 className="text-2xl font-semibold">{heading}</h1>
          <p className="mt-3 text-base text-muted-foreground">{COPY.page.notApplicable}</p>
        </section>
      );
    case "toggle_off":
      return (
        <section className="max-w-2xl" data-testid="reimbursement-toggle-off">
          <h1 className="text-2xl font-semibold">{heading}</h1>
          <p className="mt-3 text-base text-muted-foreground">
            {COPY.page.toggleOff(state.name)}{" "}
            {state.canManageFeatures ? <ToggleOffManageLine slug={slug} /> : COPY.page.toggleOffAsk}
          </p>
        </section>
      );
    case "forbidden":
      return (
        <section className="max-w-2xl" data-testid="reimbursement-forbidden">
          <h1 className="text-2xl font-semibold">{heading}</h1>
          <p className="mt-3 text-base text-muted-foreground">{COPY.queue.forbidden(state.name)}</p>
        </section>
      );
    case "load_error":
      return <ReimbursementLoadError heading={heading} message={COPY.page.loadError} href={retryHref ?? `/o/${slug}/reimbursements`} />;
  }
}

/** A read failed: say so, offer a retry, and never show an empty list (which would read as missing requests). */
export function ReimbursementLoadError({
  heading = COPY.page.heading,
  message = COPY.page.loadError,
  href,
}: {
  heading?: string;
  message?: string;
  href: string;
}) {
  return (
    <section className="max-w-2xl" data-testid="reimbursement-load-error">
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <p role="alert" className="mt-3 text-base font-medium">
        {message}
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={href}>Try again</Link>
      </Button>
    </section>
  );
}

/** The plain back link at the top of every sub-page (docs/ui-standards.md: a link, not a Button). */
export function BackToReimbursements({ slug, label = COPY.detail.back }: { slug: string; label?: string }) {
  return (
    <Link
      href={`/o/${slug}/reimbursements`}
      className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
      {label}
    </Link>
  );
}
