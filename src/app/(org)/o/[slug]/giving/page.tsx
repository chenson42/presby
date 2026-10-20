import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { assertOrgAccess, OrgAccessError, resolveOrgContext } from "@/lib/authz";
import { Button } from "@/components/ui/button";
import { GivingUnavailableNotice } from "@/components/giving/giving-unavailable-notice";
import { TestModeBadge } from "@/components/giving/test-mode-badge";
import { MEMBER_GIVING, TEST_MODE_DONOR_DETAIL } from "@/lib/giving/giving-copy";
import { readPublicGivingConfig } from "@/lib/giving/public-config";
import { getMyGiving, type MyGivingResult } from "@/lib/giving/self";
import { OrgAccessDenied, OrgAccessEnded } from "../org-states";
import { GivingNotApplicable, GivingToggleOff, MyGivingLoadError } from "./giving-states";
import { HistoryList } from "./history-list";
import { StatementsList } from "./statements-list";

/**
 * `/o/<slug>/giving` - the member's own giving: "Give online", their gifts, and
 * their year-end statements. docs/work-log/2026-10-15-online-giving.md, Flow 12
 * and Phase 3 "Component / Page Plan"; the data comes from `getMyGiving`
 * (`src/lib/giving/self.ts`, DECISION-162's self-read).
 *
 * Repeats the whole `(org)` auth pattern (the check lives in the PAGE, not the
 * layout): sign-in -> the four-way org miss -> `assertOrgAccess`. NO giving
 * permission is needed, and NO 2FA is forced here: giving is for every member,
 * holding no giving key requires no challenge, and the Edge already enforced
 * whatever the account itself requires for `/o/*`. (The treasurer's pages under
 * `admin/giving` are the ones that force it.)
 *
 * States, all designed: not-for-this-kind-of-organization and toggle-off (honest
 * pages at HTTP 200 - the viewer is a member and already knows the org exists),
 * a load error ("We can't load your giving history right now" - never an empty
 * list), then populated or empty per section. The "Give online" entry is a link
 * to the give page when online giving is live; when it is not, the same notice
 * the give page shows. No `loading.tsx`: this segment can 404 on the four-way
 * miss, and a `loading.tsx` would flush a 200 first (CLAUDE.md).
 */

export default async function MemberGivingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/giving`;

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

  let mine: MyGivingResult;
  try {
    mine = await getMyGiving(org.personId, org.organizationId);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <MyGivingLoadError slug={slug} />;
  }
  if (mine.kind === "not_applicable") return <GivingNotApplicable name={org.name} />;
  if (mine.kind === "toggle_off") return <GivingToggleOff name={org.name} slug={slug} canManageFeatures={false} />;

  // Never throws: a failure reads as "not live", so the entry shows its notice.
  const config = await readPublicGivingConfig(slug);

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{MEMBER_GIVING.heading}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your gifts to {org.name} and your year-end giving statements.
        </p>
      </div>

      <section aria-labelledby="give-online-heading" className="space-y-3" data-testid="give-online">
        {config.state === "live" ? (
          <>
            <h2 id="give-online-heading" className="text-xl font-semibold">
              {MEMBER_GIVING.giveHeading}
            </h2>
            {!config.livemode && <TestModeBadge detail={TEST_MODE_DONOR_DETAIL} />}
            <p className="text-base text-muted-foreground">{MEMBER_GIVING.giveBody}</p>
            <Button asChild className="min-h-11">
              <Link href={`/o/${slug}/giving/give`}>{MEMBER_GIVING.giveButton}</Link>
            </Button>
          </>
        ) : (
          <GivingUnavailableNotice
            organizationName={org.name}
            contactPhone={config.state === "unavailable" ? config.contactPhone : null}
            headingLevel={2}
          />
        )}
      </section>

      <section aria-labelledby="my-gifts-heading" className="space-y-3">
        <div>
          <h2 id="my-gifts-heading" className="text-xl font-semibold">
            {MEMBER_GIVING.giftsHeading}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{MEMBER_GIVING.giftsHelp}</p>
        </div>
        <HistoryList gifts={mine.gifts} truncated={mine.giftsTruncated} />
      </section>

      <section aria-labelledby="my-statements-heading" className="space-y-3">
        <div>
          <h2 id="my-statements-heading" className="text-xl font-semibold">
            {MEMBER_GIVING.statementsHeading}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{MEMBER_GIVING.statementsHelp}</p>
        </div>
        <StatementsList slug={slug} statements={mine.statements} />
      </section>
    </div>
  );
}
