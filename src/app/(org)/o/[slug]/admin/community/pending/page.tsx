import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import {
  getSessionApprovalState,
  listPendingRollActions,
  listRecentlyDecidedRollActions,
} from "@/lib/roll";
import { todayUtcYmd } from "@/lib/ymd";
import { Pagination } from "@/components/shared/pagination";
import { isFlagEnabled } from "@/lib/flags";
import { isOrgFeatureEnabled } from "@/lib/org-features";
import { OrgAccessDenied, OrgAccessEnded } from "../../../org-states";
import {
  MembersFlagOff,
  MembersForbidden,
  MembersLoadError,
} from "../members-states";
import { PendingWorklist } from "./pending-worklist";
import { RecentlyDecided } from "./recently-decided";
import { SessionStateBanner, type SessionHandOff } from "./session-state-banner";
import { listSessionSignInRows } from "@/lib/onboarding/org-invite";

const MEMBERS_CREATE_FLAG = "org_portal.members_create";

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * `/o/<slug>/admin/community/pending` — the approve/deny worklist
 * (Deliverable B's fold-in, Phase 1's "a propose-only Increment 1 ships
 * people invisible in the directory" gap). Same two-axis gate as every
 * other `admin/community*` page: `org_portal.members_create` (flag) AND its
 * matching `organization_feature_toggles` row.
 *
 * The three reads are gated on `roll.approve` OR `roll.propose` internally,
 * checked inside their own `withOrgContext()` transactions — not re-checked
 * here. The page switches on the returned `mode` (DECISION-204): an approver
 * gets the decide queue (checkboxes, Approve, Deny, bulk), a propose-only
 * holder a read-only queue with the Flow 7 banner and Withdraw. `?page=`
 * pages the queue 50 at a time (the bulk cap).
 */
export default async function PendingMembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page: rawPage } = await searchParams;
  const page = parsePage(rawPage);

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/community/pending`)}`,
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
        <OrgAccessEnded
          name={resolved.name}
          endedOn={resolved.endedOn}
          slug={slug}
        />
      );
    case "ok":
      break;
  }

  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const flagOn = await isFlagEnabled(MEMBERS_CREATE_FLAG);
  const toggleOn = flagOn
    ? await isOrgFeatureEnabled(
        resolved.org.personId,
        resolved.org.organizationId,
        MEMBERS_CREATE_FLAG,
      )
    : false;
  if (!flagOn || !toggleOn) {
    return (
      <MembersFlagOff name={resolved.org.name} heading="Pending approvals" />
    );
  }

  let result;
  let decided;
  let sessionState;
  try {
    result = await listPendingRollActions(
      resolved.org.personId,
      resolved.org.organizationId,
      { page },
    );
    if (result.kind === "ok") {
      decided = await listRecentlyDecidedRollActions(
        resolved.org.personId,
        resolved.org.organizationId,
      );
      sessionState = await getSessionApprovalState(
        resolved.org.personId,
        resolved.org.organizationId,
      );
    }
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return (
      <MembersLoadError
        backHref={`/o/${slug}/admin/community/pending`}
        heading="Pending approvals"
      />
    );
  }

  if (result.kind === "forbidden") {
    return (
      <MembersForbidden name={resolved.org.name} heading="Pending approvals" />
    );
  }

  const { mode, actions, pagination, viewer } = result;
  // Decide mode shows a banner only when there is no Session at all; read mode
  // shows every state (the proposer needs to know why nothing is moving).
  const state = sessionState?.kind === "ok" ? sessionState.state : null;
  const showBanner =
    state !== null && (mode === "read" || state.kind === "no_session");

  // The Session hand-off (Community Increment 2b): read only when the banner is
  // the `no_sign_in` one. `listSessionSignInRows` answers `forbidden` unless the
  // viewer holds BOTH `people.manage` and `officers.manage`, and everyone else
  // (and any failure) gets the one sentence with no names and no link.
  let handOff: SessionHandOff = { kind: "other" };
  if (showBanner && state?.kind === "no_sign_in") {
    const rows = await listSessionSignInRows({
      organizationId: resolved.org.organizationId,
      actingPersonId: resolved.org.personId,
      actingUserId: session.user.id,
      actingUserEmail: session.user.email ?? null,
    });
    if (rows.kind === "ok") {
      let connectEnabled = false;
      try {
        connectEnabled = await isOrgFeatureEnabled(
          resolved.org.personId,
          resolved.org.organizationId,
          "org_portal.sign_in_connect",
        );
      } catch (err) {
        if (err instanceof OrgAccessError) throw err;
      }
      handOff = { kind: "rows", rows: rows.rows, connectEnabled };
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pending approvals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
        {mode === "read" && (
          <p className="mt-2 text-sm text-muted-foreground">
            You can see what&apos;s waiting for the Session. Only members of the
            Session can approve.
          </p>
        )}
      </div>

      {showBanner && state && <SessionStateBanner slug={slug} state={state} handOff={handOff} />}

      <section aria-labelledby="waiting-heading" className="space-y-3">
        <h2 id="waiting-heading" className="text-lg font-semibold">
          Waiting for the Session
        </h2>
        <PendingWorklist
          slug={slug}
          actions={actions}
          mode={mode}
          viewer={viewer}
          today={todayUtcYmd()}
        />
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          buildHref={(target) =>
            target <= 1
              ? `/o/${slug}/admin/community/pending`
              : `/o/${slug}/admin/community/pending?page=${target}`
          }
        />
      </section>

      {decided && decided.kind === "ok" && (
        <RecentlyDecided actions={decided.actions} />
      )}
    </section>
  );
}
