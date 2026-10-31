/**
 * The closed set of operator changes the dashboard's "Recent operator changes"
 * card reports, and the one plain-language label for each (Copy, group E of
 * docs/work-log/2026-10-25-platform-admin-redesign-inc1.md). Pure data, no
 * imports: the reader's SQL filter, the reader's row type and the card's text
 * all come from this one list.
 *
 * Every key is an `audit_events.action` written today by a verified writer.
 * `totp.reset` is defined in AUDIT_ACTIONS but nothing writes it, so it is not
 * here. The two invitation keys are further narrowed in SQL by a metadata flag
 * (`selfAddressed` / `inviterIsInvitee`), so the labels state a fact and call
 * nothing wrong: DECISION-183 permits a self-addressed designation, and
 * DECISION-194's residual is "detected by audit, not prevented".
 */
export const CHANGE_ACTIONS = [
  "org.founding_administrator.revoked",
  "org.treasurer.revoked",
  "invitation.created",
  "invitation.accepted",
  "user.role.assigned",
  "user.role.removed",
  "feature_flag.toggled",
  "user.2fa_force_reset",
  "user.deactivated",
  "user.reactivated",
] as const;

export type ChangeAction = (typeof CHANGE_ACTIONS)[number];

export const CHANGE_LABELS: Record<ChangeAction, string> = {
  "org.founding_administrator.revoked": "Founding administrator removed",
  "org.treasurer.revoked": "Treasurer removed",
  "invitation.created": "Self-addressed invitation sent",
  "invitation.accepted": "Self-addressed invitation accepted",
  "user.role.assigned": "Platform role assigned",
  "user.role.removed": "Platform role removed",
  "feature_flag.toggled": "Feature flag changed",
  "user.2fa_force_reset": "Two-factor reset for an account",
  "user.deactivated": "Account deactivated",
  "user.reactivated": "Account reactivated",
};

export const UNKNOWN_ORGANIZATION = "Unknown organization";
