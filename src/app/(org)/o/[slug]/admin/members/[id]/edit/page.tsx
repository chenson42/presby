import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Lock, Users } from "lucide-react";
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
import { getSensitiveInfoGrants } from "@/lib/person-sensitive";
import {
  getPendingRollActionsForPerson,
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

const MEMBERS_CREATE_FLAG = "org_portal.members_create";
const ROLL_ACTION_EDIT_FLAG = "org_portal.members_roll_action_edit";
const SENSITIVE_INFO_FLAG = "org_portal.sensitive_info";
const CHILDREN_MINISTRY_FLAG = "org_portal.children_ministry";

/**
 * `/o/<slug>/admin/members/<id>/edit` — Increment 2 (docs/work-log/
 * 2026-08-26-member-management-edit-person.md). A thin server page: auth →
 * flag → org-toggle → read the person → render the client form. The
 * `people.manage` permission check happens inside `getPersonForEdit()`/
 * `updatePerson()`, not duplicated here, same discipline as `admin/
 * members/new/page.tsx`. Rides the SAME flag/toggle as Increment 1 — this
 * is additive to the existing `/admin/members` surface, not a new one.
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
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/members/${id}/edit`)}`,
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
    if (rollActionEditFlagOn) {
      const pendingResult = await getPendingRollActionsForPerson(
        resolved.org.personId,
        resolved.org.organizationId,
        id,
      );
      if (pendingResult.kind === "ok") {
        pendingRollActions = pendingResult.actions;
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
    return <MembersLoadError backHref={`/o/${slug}/admin/members`} />;
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
            href={`/o/${slug}/admin/members/${id}/edit/sensitive`}
            className="flex items-center gap-2 text-sm underline underline-offset-2"
          >
            <Lock className="size-4 shrink-0" aria-hidden />
            Pastoral notes, demographics, medical & disability information
          </Link>
        </div>
      )}

      {showGuardiansLink && (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <Link
            href={`/o/${slug}/admin/members/${id}/edit/guardians`}
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
