import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
  type OrganizationType,
} from "@/lib/authz";
import { getCongregationOversightList } from "@/lib/presbytery";
import { isFlagEnabled } from "@/lib/flags";
import {
  PlaceholderFlagOff,
  PlaceholderNotAvailable,
} from "@/components/org-portal/coming-soon";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import { OversightForbidden, OversightLoadError } from "./oversight-states";
import { OversightList } from "./oversight-list";

const OVERSIGHT_FLAG = "org_portal.oversight";
const AREA = "Congregation Oversight";

/**
 * `/o/<slug>/admin/oversight` — Presbytery program Increments 3/3b Phase 3
 * design (`docs/work-log/2026-08-27-presbytery-program.md`, DECISION-118
 * through 121). Replaces the product-IA scaffold's `ComingSoon` body
 * (`docs/work-log/2026-08-27-product-ia-scaffold.md`, DECISION-117) with the
 * real list — the SAME flag (`org_portal.oversight`) and the SAME
 * flag-then-org-type ordering the stub already ran; only the final,
 * flag-on-and-org-type-OK branch changes (`ComingSoon` → the real read +
 * list).
 *
 * THREE CHECKS, IN THIS ORDER, same as every other page under `(org)`: flag,
 * then org type, then the `congregation_oversight.manage` permission gate
 * (`getCongregationOversightList()`'s own read). A congregation/synod/GA org
 * with the flag ON still lands on `PlaceholderNotAvailable`, never
 * `OversightForbidden` — the latter reads as "ask your administrator," which
 * is wrong here: `congregation_oversight.manage` has NO default binding
 * (DECISION-119), so there is no fix at a non-presbytery org anyway, but the
 * copy difference matters (product-not-here vs. permission-denied).
 */
const OVERSIGHT_ORG_TYPES: readonly OrganizationType[] = ["presbytery"];

export default async function OversightPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/oversight`)}`,
    );
  }

  const resolved = await resolveOrgContext(session.user.id, slug);

  switch (resolved.kind) {
    case "not-found":
      notFound();
    case "forbidden":
      return (
        <OrgAccessDenied
          name={resolved.name}
          organizationType={resolved.organizationType}
          slug={slug}
        />
      );
    case "ended":
      return (
        <OrgAccessEnded name={resolved.name} endedOn={resolved.endedOn} slug={slug} />
      );
    case "ok":
      break;
  }

  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const oversightEnabled = await isFlagEnabled(OVERSIGHT_FLAG);
  if (!oversightEnabled) {
    return <PlaceholderFlagOff area={AREA} orgName={resolved.org.name} />;
  }

  if (!OVERSIGHT_ORG_TYPES.includes(resolved.org.organizationType)) {
    return <PlaceholderNotAvailable area={AREA} orgName={resolved.org.name} />;
  }

  let result;
  try {
    result = await getCongregationOversightList(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <OversightLoadError slug={slug} />;
  }

  if (result.kind !== "ok") {
    if (result.kind === "forbidden") {
      return <OversightForbidden name={resolved.org.name} />;
    }
    return <OversightLoadError slug={slug} />;
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{AREA}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{resolved.org.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The presbytery&apos;s own record of each member congregation&apos;s
          viability, buildings, and insurance — never the congregation&apos;s
          own data.
        </p>
      </div>
      <OversightList entries={result.data} slug={slug} />
    </section>
  );
}
