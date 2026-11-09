import { OrgAccessError } from "@/lib/authz";
import { StatusChip } from "@/components/worship/status-chip";
import { formatWhen } from "@/components/worship/service-when";
import { MEMBER_COPY, NAV_COPY } from "@/lib/worship/copy";
import { getRequest } from "@/lib/worship/reads";
import { gateWorshipPage, readOrState } from "../../worship-gate";
import { BackLink, RequestClosed } from "../../worship-states";
import { RequestActions } from "../../request-actions";

/**
 * `/o/<slug>/worship/requests/<assignmentId>` - one request, the page the email's
 * single-request link opens (Copy G6). A request that is not the viewer's, an
 * unknown id and a draft's id are the SAME `notFound()` (the id-guessing hole is
 * closed in the store; this page only renders its answer). A withdrawn request, a
 * cancelled service or one that has started is "This request is no longer open"
 * with the way back to the schedule.
 *
 * Signed out, the visitor is sent to sign in with this exact path as the
 * `callbackUrl`, so the email link survives the sign-in (and the 2FA challenge the
 * proxy adds for an enrolled member).
 */
export default async function WorshipRequestPage({
  params,
}: {
  params: Promise<{ slug: string; assignmentId: string }>;
}) {
  const { slug, assignmentId } = await params;
  const path = `/o/${slug}/worship/requests/${assignmentId}`;
  const gate = await gateWorshipPage({ slug, path, heading: MEMBER_COPY.request.heading });
  if (!gate.ok) return gate.node;
  const { identity } = gate;

  let result: Awaited<ReturnType<typeof getRequest>>;
  try {
    result = await getRequest(identity.viewer, { assignmentId });
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    result = { kind: "invalid_input", message: "" };
  }
  const read = readOrState(result, { slug, name: identity.organizationName, heading: MEMBER_COPY.request.heading, retryHref: path });
  if (!read.ok) return read.node;
  const request = read.data;
  if (!request.open) return <RequestClosed slug={slug} />;

  const when = formatWhen(request.startsAt);
  const status = request.status === "withdrawn" ? "declined" : request.status;
  return (
    <div className="max-w-2xl space-y-6">
      <BackLink href={`/o/${slug}/worship`} label={NAV_COPY.backToWorship} />
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">{MEMBER_COPY.request.heading}</h1>
        <p className="text-base [overflow-wrap:anywhere]" data-testid="request-body">
          {MEMBER_COPY.request.body(request.organizationName, request.positionName, request.teamName, when)}
        </p>
        {request.location ? (
          <p className="text-base text-muted-foreground [overflow-wrap:anywhere]">{MEMBER_COPY.request.where(request.location)}</p>
        ) : null}
      </div>
      <section className="space-y-3 rounded-lg border border-border bg-card p-4" aria-live="polite">
        <StatusChip status={status} declineReason={request.declineReason} />
        {request.status === "confirmed" && <p className="text-base font-medium">{MEMBER_COPY.request.confirmed}</p>}
        {request.status === "declined" && <p className="text-base font-medium">{MEMBER_COPY.request.declined}</p>}
        <RequestActions
          slug={slug}
          assignmentId={request.assignmentId}
          status={status as "requested" | "confirmed" | "declined"}
          positionName={request.positionName}
          whenLabel={when}
          idPrefix="request"
        />
      </section>
    </div>
  );
}
