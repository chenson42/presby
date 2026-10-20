import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { assertOrgAccess, OrgAccessError, resolveOrgContext } from "@/lib/authz";
import { loadGivingToggle } from "@/lib/giving/access";
import { giveHeading } from "@/lib/giving/giving-copy";
import { readPublicGivingConfig } from "@/lib/giving/public-config";
import { GiveForm } from "@/components/giving/give-form";
import { GivingUnavailableNotice } from "@/components/giving/giving-unavailable-notice";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import { GivingLoadError, GivingNotApplicable, GivingToggleOff } from "../../admin/giving/giving-admin-states";
import { createMemberGiveSessionAction } from "./actions";

/**
 * `/o/<slug>/giving/give` - a signed-in member gives. docs/work-log/2026-10-15-
 * online-giving.md, Phase 3 "Member give". Repeats the whole `(org)` auth pattern
 * (the check lives in the PAGE, not the layout): sign-in -> the four-way org miss
 * -> `assertOrgAccess` -> applicability and the org's Giving toggle. NO giving
 * permission is needed: giving is for every member, so this is the one giving
 * page a plain member can open. The Edge already enforced 2FA for `/o/*`; there is
 * no further forcing here.
 *
 * States: not-for-this-kind-of-organization and toggle-off (honest, HTTP 200,
 * never a 404 - the viewer is a member and already knows the org exists), a
 * load error, the unavailable notice (giving is on but not live: no Stripe
 * connection yet, or no online fund), and the form. The funds and rates come
 * from the same `live` predicate the intent function enforces. `force-dynamic`
 * (a fresh single-attempt key per request); no `loading.tsx`.
 */
export const dynamic = "force-dynamic";

export default async function MemberGivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/giving/give`;

  const session = await cachedAuth();
  if (!session?.user) redirect(`/signin?callbackUrl=${encodeURIComponent(path)}`);

  const resolved = await resolveOrgContext(session.user.id, slug);
  switch (resolved.kind) {
    case "not-found":
      notFound();
    case "forbidden":
      return <OrgAccessDenied name={resolved.name} organizationType={resolved.organizationType} slug={slug} />;
    case "ended":
      return <OrgAccessEnded name={resolved.name} endedOn={resolved.endedOn} slug={slug} />;
    case "ok":
      break;
  }
  const org = resolved.org;
  await assertOrgAccess(org.personId, org.organizationId);

  let toggle: Awaited<ReturnType<typeof loadGivingToggle>>;
  try {
    toggle = await loadGivingToggle({
      personId: org.personId,
      organizationId: org.organizationId,
      organizationType: org.organizationType,
    });
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <GivingLoadError slug={slug} href={path} />;
  }
  if (toggle === "not_applicable") return <GivingNotApplicable name={org.name} />;
  if (toggle === "toggle_off") return <GivingToggleOff name={org.name} slug={slug} canManageFeatures={false} />;

  const config = await readPublicGivingConfig(slug);

  return (
    <div className="max-w-xl space-y-6">
      <Link
        href={`/o/${slug}`}
        className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ArrowLeft className="mr-1 size-4" aria-hidden />
        Back to {org.name}
      </Link>

      {config.state !== "live" ? (
        <GivingUnavailableNotice
          organizationName={org.name}
          contactPhone={config.state === "unavailable" ? config.contactPhone : null}
        />
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{giveHeading(org.name)}</h1>
          <GiveForm
            mode="member"
            action={createMemberGiveSessionAction.bind(null, slug)}
            initialKey={randomUUID()}
            funds={config.funds}
            cardEnabled={config.cardEnabled}
            achEnabled={config.achEnabled}
            rates={config.rates}
            minAmountCents={config.minAmountCents}
            maxAmountCents={config.maxAmountCents}
            livemode={config.livemode}
            contactPhone={config.contactPhone}
          />
        </>
      )}
    </div>
  );
}
