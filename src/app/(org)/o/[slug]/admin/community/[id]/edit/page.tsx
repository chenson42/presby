import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Camera, Lock, Users } from "lucide-react";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  hasPermission,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { isOrgFeatureEnabled } from "@/lib/org-features";
import { getHouseholds } from "@/lib/directory";
import { getPersonForEdit } from "@/lib/people";
import { getCommunityStatus, type CommunityStatus } from "@/lib/community";
import { getSensitiveInfoGrants } from "@/lib/person-sensitive";
import { EDIT_LINK_COPY } from "@/lib/person-photos/copy";
import { personPhotosEnabled } from "@/lib/person-photos/reader";
import {
  getPendingRollActionsForPerson,
  getSessionApprovalState,
  type PendingRollActionForPerson,
} from "@/lib/roll";
import { OrgAccessDenied, OrgAccessEnded } from "../../../../org-states";
import {
  MembersFlagOff,
  MembersForbidden,
  MembersLoadError,
} from "../../members-states";
import { EditPersonForm } from "./edit-person-form";
import { RecordRollActionForm } from "./record-roll-action-form";
import { ConnectionCard } from "./connection-card";
import { ParticipantControls } from "./participant-controls";

const MEMBERS_CREATE_FLAG = "org_portal.members_create";
const ROLL_ACTION_EDIT_FLAG = "org_portal.members_roll_action_edit";
const SENSITIVE_INFO_FLAG = "org_portal.sensitive_info";
const CHILDREN_MINISTRY_FLAG = "org_portal.children_ministry";

/**
 * `/o/<slug>/admin/community/<id>/edit` — Increment 2 (docs/work-log/
 * 2026-08-26-member-management-edit-person.md). A thin server page: auth →
 * flag → org-toggle → read the person → render the client form. The
 * `people.manage` permission check happens inside `getPersonForEdit()`/
 * `updatePerson()`, not duplicated here, same discipline as `admin/
 * members/new/page.tsx`. Rides the SAME flag/toggle as Increment 1 — this
 * is additive to the existing `/admin/community` surface, not a new one.
 *
 * `RecordRollActionForm` (docs/work-log/2026-08-26-member-roll-on-edit.md
 * Phase 3) is gated ADDITIONALLY on `ROLL_ACTION_EDIT_FLAG` — the
 * `MEMBERS_CREATE_FLAG`+toggle pair already required to reach this page at
 * all, AND the new global flag, both on. No new per-org toggle: this reuses
 * `org_portal.members_create`'s existing organization-feature-toggle row
 * rather than asking a church to flip a second checkbox. `roll.propose`
 * itself is checked inside `recordRollAction()`, not here — a viewer
 * without it simply gets `forbidden` on submit, same discipline as every
 * other permission gate on this page.
 *
 * The link into `./edit/sensitive` (docs/work-log/
 * 2026-08-26-member-sensitive-info.md, DECISION-108) renders only when BOTH
 * `SENSITIVE_INFO_FLAG`'s flag+toggle are on AND `getSensitiveInfoGrants()`
 * returns at least one `true` — absent otherwise, never disabled/greyed
 * (Phase 1's explicit requirement). The flag/toggle check here is a cheap
 * protective addition beyond Phase 3's literal wording (permission alone):
 * it avoids ever showing a permission holder a link into a sub-route whose
 * own flag is off, which would just bounce them to that page's flag-off
 * state — the sub-route re-checks both anyway (defense in depth).
 *
 * The link into `./edit/guardians` (docs/work-log/
 * 2026-08-26-childrens-ministry.md, DECISION-111/114) renders only when
 * BOTH `CHILDREN_MINISTRY_FLAG` is on (checked bare — no org toggle, same
 * shape as `org_portal.officers`/`org_portal.groups`) AND the viewer holds
 * `children.roster` directly — absent otherwise, never disabled, same
 * discipline as the sensitive-info link above. Checked as an INDEPENDENT
 * awaited call, not folded into the same `Promise.all` as the sensitive-info
 * checks (Phase 3 Edge Cases note): a shared call-ordering bug between the
 * two independent conditions must not be able to cross-contaminate either
 * card's render output.
 */
export default async function EditMemberPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/community/${id}/edit`)}`,
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
    return <MembersFlagOff name={resolved.org.name} />;
  }

  const rollActionEditFlagOn = await isFlagEnabled(ROLL_ACTION_EDIT_FLAG);
  const sensitiveInfoFlagOn = await isFlagEnabled(SENSITIVE_INFO_FLAG);
  const sensitiveInfoToggleOn = sensitiveInfoFlagOn
    ? await isOrgFeatureEnabled(
        resolved.org.personId,
        resolved.org.organizationId,
        SENSITIVE_INFO_FLAG,
      )
    : false;

  let personResult;
  let households: { householdId: string; name: string }[] = [];
  let pendingRollActions: PendingRollActionForPerson[] = [];
  let showSensitiveInfoLink = false;
  let showGuardiansLink = false;
  let showPhotosLink = false;
  let communityStatus: CommunityStatus | null = null;
  let canPropose = false;
  let sessionCannotAct = false;
  try {
    personResult = await getPersonForEdit(
      resolved.org.personId,
      resolved.org.organizationId,
      id,
    );
    const householdsResult = await getHouseholds(
      resolved.org.personId,
      resolved.org.organizationId,
    );
    if (householdsResult.kind === "ok") {
      households = householdsResult.households.map((h) => ({
        householdId: h.householdId,
        name: h.name,
      }));
    }
    const statusResult = await getCommunityStatus(
      resolved.org.personId,
      resolved.org.organizationId,
      id,
    );
    if (statusResult.kind === "ok") {
      communityStatus = statusResult.status;
    }
    if (rollActionEditFlagOn) {
      canPropose = await hasPermission(
        resolved.org.personId,
        resolved.org.organizationId,
        "roll.propose",
      );
      const pendingResult = await getPendingRollActionsForPerson(
        resolved.org.personId,
        resolved.org.organizationId,
        id,
      );
      if (pendingResult.kind === "ok") {
        pendingRollActions = pendingResult.actions;
      }
      if (canPropose && pendingRollActions.length > 0) {
        // Flow 7: only read when a proposal is actually waiting, so the common
        // page load pays nothing for it.
        const stateResult = await getSessionApprovalState(
          resolved.org.personId,
          resolved.org.organizationId,
        );
        sessionCannotAct =
          stateResult.kind === "ok" && stateResult.state.kind !== "ready";
      }
    }
    if (sensitiveInfoFlagOn && sensitiveInfoToggleOn) {
      const grants = await getSensitiveInfoGrants(
        resolved.org.personId,
        resolved.org.organizationId,
      );
      showSensitiveInfoLink =
        grants.pastoralNotes ||
        grants.demographics ||
        grants.medical ||
        grants.disabilities;
    }
    const childrenMinistryFlagOn = await isFlagEnabled(CHILDREN_MINISTRY_FLAG);
    if (childrenMinistryFlagOn) {
      showGuardiansLink = await hasPermission(
        resolved.org.personId,
        resolved.org.organizationId,
        "children.roster",
      );
    }
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <MembersLoadError backHref={`/o/${slug}/admin/community`} />;
  }

  // The link into `./edit/photos` (docs/work-log/2026-10-26-person-photos-inc1.md,
  // Copy C7): shown only when the org's "Photos of people" toggle is on, and
  // only on a page the viewer already holds `people.manage` for (`getPersonForEdit`
  // just said `ok`). An independent awaited call, like the guardians link, and a
  // failed read hides the link rather than taking the edit page down: the photos
  // page re-checks the toggle and the permission itself.
  if (personResult.kind === "ok") {
    try {
      showPhotosLink = await personPhotosEnabled({
        organizationId: resolved.org.organizationId,
        actorPersonId: resolved.org.personId,
      });
    } catch {
      showPhotosLink = false;
    }
  }

  if (personResult.kind === "forbidden") {
    return (
      <MembersForbidden name={resolved.org.name} heading="Edit person" />
    );
  }
  if (personResult.kind === "not_found") {
    notFound();
  }

  return (
    <section className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit person</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
      </div>

      {/* M2 (docs/reviews/2026-08-26-portal-ux.md): the three concerns on
          this page — editing the profile, recording a roll action, and the
          gated link into sensitive information — each get their own
          `bg-card` panel instead of sharing one undifferentiated scroll
          separated by a bare divider. Cards, not tabs (out of scope for a
          polish batch per the task brief). */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Profile</h2>
        <EditPersonForm
          slug={slug}
          person={personResult.person}
          households={households}
        />
      </div>

      {communityStatus && (
        <div className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
          <ConnectionCard
            status={communityStatus}
            pendingActions={pendingRollActions}
            slug={slug}
            personName={`${personResult.person.firstName} ${personResult.person.lastName}`}
            canWithdraw={rollActionEditFlagOn && canPropose}
            sessionCannotAct={sessionCannotAct}
          />
          {rollActionEditFlagOn && canPropose && (
            <ParticipantControls
              slug={slug}
              personId={id}
              personName={`${personResult.person.firstName} ${personResult.person.lastName}`}
              orgName={resolved.org.name}
              canRemove={communityStatus.connection === "participant"}
              undo={
                communityStatus.latestAction?.onRecordKind
                  ? {
                      rollActionId: communityStatus.latestAction.id,
                      entryLabel:
                        communityStatus.latestAction.kind ===
                        "other_participant_removed"
                          ? "removal"
                          : "enrolment",
                    }
                  : null
              }
            />
          )}
        </div>
      )}

      {rollActionEditFlagOn && (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          {/* `RecordRollActionForm` supplies its own "Record a roll action"
              heading + description — the card is a plain wrapper, not a
              second header. */}
          <RecordRollActionForm
            slug={slug}
            personId={id}
            pendingActions={pendingRollActions}
          />
        </div>
      )}

      {showSensitiveInfoLink && (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <Link
            href={`/o/${slug}/admin/community/${id}/edit/sensitive`}
            className="flex items-center gap-2 text-sm underline underline-offset-2"
          >
            <Lock className="size-4 shrink-0" aria-hidden />
            Pastoral notes, demographics, medical & disability information
          </Link>
        </div>
      )}

      {showPhotosLink && (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <Link
            href={`/o/${slug}/admin/community/${id}/edit/photos`}
            className="flex min-h-11 items-center gap-2 text-sm underline underline-offset-2"
          >
            <Camera className="size-4 shrink-0" aria-hidden />
            {EDIT_LINK_COPY}
          </Link>
        </div>
      )}

      {showGuardiansLink && (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <Link
            href={`/o/${slug}/admin/community/${id}/edit/guardians`}
            className="flex items-center gap-2 text-sm underline underline-offset-2"
          >
            <Users className="size-4 shrink-0" aria-hidden />
            Guardians
          </Link>
        </div>
      )}
    </section>
  );
}
