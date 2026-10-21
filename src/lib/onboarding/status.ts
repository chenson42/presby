/**
 * Derived invitation status and email delivery state. PURE and client-safe:
 * no database, no `server-only`, so the admin list component (a client
 * component) and the server list reader share one vocabulary.
 *
 * Expiry is DERIVED at read time, never a job (Phase 1 Flow 5): an open row
 * whose `expires_at` has passed is "expired" and keeps blocking a second
 * invitation until a resend supersedes it or the operator revokes it.
 * `superseded` rows are replaced by their successor and are hidden from every
 * list; the value exists only so a caller can filter them.
 */

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked" | "blocked";

export interface InvitationStatusInput {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  supersededAt: Date | null;
  blockedAt: Date | null;
  expiresAt: Date;
}

export function deriveInvitationStatus(
  row: InvitationStatusInput,
  now: Date,
): InvitationStatus | "superseded" {
  if (row.acceptedAt) return "accepted";
  if (row.revokedAt) return "revoked";
  if (row.blockedAt) return "blocked";
  if (row.supersededAt) return "superseded";
  return row.expiresAt.getTime() <= now.getTime() ? "expired" : "pending";
}

export type DeliveryState =
  | "queued"
  | "sent"
  | "delivered"
  | "bounced"
  | "failed"
  | "cancelled"
  | "unknown";

export interface QueueRowForDelivery {
  status: string;
  deliveredAt: Date | null;
  bouncedAt: Date | null;
  complainedAt?: Date | null;
}

/**
 * Where an invitation's email is. `null` (no queue row found) is "unknown":
 * the link is written at insert, so this is only a defensive value.
 * A bounce outranks a delivery timestamp: a provider can report both.
 */
export function deliveryState(row: QueueRowForDelivery | null): DeliveryState {
  if (!row) return "unknown";
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "failed") return "failed";
  if (row.bouncedAt) return "bounced";
  if (row.status === "sent") return row.deliveredAt ? "delivered" : "sent";
  if (row.status === "queued" || row.status === "processing") return "queued";
  return "unknown";
}
