import { Ban, CircleCheck, Clock, TimerOff, TriangleAlert, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { OrgSentSummary } from "@/lib/onboarding/issue";
import { INVITATION_STATUS_LABEL } from "@/lib/onboarding/labels";
import { ORG_SENT_PANEL_COPY, SIGN_IN_CARD_COPY } from "@/lib/onboarding/sign-in-copy";
import type { InvitationStatus } from "@/lib/onboarding/status";
import { RevokeAllControl } from "./revoke-all-control";

const STATUS_ICON: Record<InvitationStatus, LucideIcon> = {
  pending: Clock,
  accepted: CircleCheck,
  expired: TimerOff,
  revoked: Ban,
  blocked: TriangleAlert,
};

/**
 * "Sign-in invitations sent by this organization": a platform operator's masked
 * view of the invitations a congregation sent to its own people (Phase 3, F198),
 * and the second takedown lever. Counts by status, one row per invitation with
 * the MASKED address (masked in SQL: the full address never reaches this
 * component) and its status, and no person name, ever: a platform role holds no
 * authority over a congregation's people (Two Hierarchies Intersect Nowhere).
 * `summary` is `null` when the read failed; the panel says so rather than
 * showing an all-clear list. The control posts `scope=org_sent`.
 */
export function OrgSentInvitations({
  organizationId,
  summary,
}: {
  organizationId: string;
  summary: OrgSentSummary | null;
}) {
  const copy = ORG_SENT_PANEL_COPY;
  return (
    <section
      data-testid="org-sent-invitations"
      className="mt-8 rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{copy.heading}</h2>
      {summary === null ? (
        <p role="alert" className="mt-2 text-sm">
          {SIGN_IN_CARD_COPY.loadFailed}
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm">
            {copy.counts(summary.counts.pending, summary.counts.accepted, summary.counts.expired, summary.counts.revoked)}
          </p>
          {summary.rows.length > 0 && (
            <ul className="mt-3 space-y-2">
              {summary.rows.map((row) => {
                const Icon = STATUS_ICON[row.status];
                return (
                  <li
                    key={row.id}
                    data-testid="org-sent-row"
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border p-3 text-sm"
                  >
                    <span className="break-all font-medium">{row.maskedAddress ?? "Address removed"}</span>
                    <Badge variant="outline">
                      <Icon aria-hidden="true" />
                      {INVITATION_STATUS_LABEL[row.status]}
                    </Badge>
                    <span className="text-muted-foreground">
                      Sent <FormattedDate value={row.createdAt} mode="date" />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {summary.revocable > 0 && (
            <RevokeAllControl
              organizationId={organizationId}
              scope="org_sent"
              buttonLabel={copy.revokeAllButton(summary.revocable)}
              dialogTitle={copy.revokeAllButton(summary.revocable)}
              dialogDescription={copy.revokeAllConfirm}
            />
          )}
        </>
      )}
    </section>
  );
}
