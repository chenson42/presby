import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import {
  getCredentialsFormOptions,
  listAppointments,
  listOrdinations,
} from "@/lib/credentials";
import { isFlagEnabled } from "@/lib/flags";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import {
  CredentialsFlagOff,
  CredentialsForbidden,
  CredentialsLoadError,
} from "./credentials-states";
import { OrdinationList } from "./ordination-list";
import { AppointmentList } from "./appointment-list";
import { RecordOrdinationForm } from "./record-ordination-form";
import { RecordAppointmentForm } from "./record-appointment-form";

/**
 * `/o/<slug>/admin/credentials` — the recording surface for a minister's
 * ordination-status changes and pastoral appointments. Presbytery-
 * functionality Increment 2 Phase 3 design (`docs/work-log/
 * 2026-08-26-presbytery-functionality.md`), DECISION-112/116.
 *
 * ONE TREE, TWO SECTIONS on one page (Phase 3's Component/Page Plan) —
 * ordinations and appointments share one permission
 * (`credentials.manage`), one form-options query, and one clerk's mental
 * model ("manage this minister's standing"), so a second route segment
 * would only add navigation, not clarity.
 *
 * REPEATS THE `(org)` AUTH PATTERN IN FULL, same as `admin/officers/
 * page.tsx` — see that file's header for the fuller rationale on why the
 * auth check lives in the page rather than the layout.
 *
 * THE FLAG CHECK RUNS BEFORE ANY `credentials.ts` READ IS EVER CALLED —
 * `org_portal.credentials` answers "is this feature on at all" and
 * `credentials.manage` answers "may THIS person administer credentials
 * here" — two different questions, identical ordering to `admin/officers/
 * page.tsx`.
 */
export default async function CredentialsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/credentials`)}`,
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

  const credentialsEnabled = await isFlagEnabled("org_portal.credentials");
  if (!credentialsEnabled) {
    return <CredentialsFlagOff name={resolved.org.name} />;
  }

  let ordinationsResult;
  try {
    ordinationsResult = await listOrdinations(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <CredentialsLoadError slug={slug} />;
  }

  if (ordinationsResult.kind !== "ok") {
    if (ordinationsResult.kind === "forbidden") {
      return <CredentialsForbidden name={resolved.org.name} />;
    }
    return <CredentialsLoadError slug={slug} />;
  }

  let appointmentsResult;
  try {
    appointmentsResult = await listAppointments(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <CredentialsLoadError slug={slug} />;
  }

  if (appointmentsResult.kind !== "ok") {
    // Unreachable in practice — `listOrdinations()` already confirmed the
    // same `credentials.manage` gate above. Handled anyway rather than
    // assumed, same discipline `admin/officers/page.tsx` documents for its
    // own redundant checks.
    if (appointmentsResult.kind === "forbidden") {
      return <CredentialsForbidden name={resolved.org.name} />;
    }
    return <CredentialsLoadError slug={slug} />;
  }

  let optionsResult;
  try {
    optionsResult = await getCredentialsFormOptions(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <CredentialsLoadError slug={slug} />;
  }

  if (optionsResult.kind !== "ok") {
    if (optionsResult.kind === "forbidden") {
      return <CredentialsForbidden name={resolved.org.name} />;
    }
    return <CredentialsLoadError slug={slug} />;
  }

  return (
    <section className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Credentials</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Ordinations</h2>
        <OrdinationList entries={ordinationsResult.data} slug={slug} />
      </div>

      <div className="max-w-md space-y-4">
        <h3 className="text-lg font-semibold">Record an ordination</h3>
        <RecordOrdinationForm slug={slug} people={optionsResult.data.people} />
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Pastoral appointments</h2>
        <AppointmentList entries={appointmentsResult.data} slug={slug} />
      </div>

      <div className="max-w-md space-y-4">
        <h3 className="text-lg font-semibold">Record an appointment</h3>
        <RecordAppointmentForm
          slug={slug}
          people={optionsResult.data.people}
          servingOrgs={optionsResult.data.servingOrgs}
        />
      </div>
    </section>
  );
}
