// Load schema.ts first: a pre-existing circular import (org.ts -> schema.ts ->
// domain/index.ts -> authz.ts -> org.ts) breaks when a domain file is the FIRST
// module in the cycle to load (see organizations/[id]/actions.test.ts).
import "@/lib/db/schema";
import { describe, expect, it } from "vitest";
import { ACCOUNT_INVITATION_BLOCKED_REASONS } from "@/lib/db/domain/invitations";
import { deriveInvitationStatus, deliveryState, type InvitationStatusInput } from "./status";
import {
  BLOCKED_REASON_OPERATOR_COPY,
  DELIVERY_STATE_LABEL,
  INVITATION_STATUS_LABEL,
  INVITEE_BLOCKED_COPY,
} from "./labels";

const NOW = new Date("2026-10-21T12:00:00Z");
const open: InvitationStatusInput = {
  acceptedAt: null, revokedAt: null, supersededAt: null, blockedAt: null,
  expiresAt: new Date("2026-10-28T12:00:00Z"),
};

describe("deriveInvitationStatus", () => {
  it("an open row before its expiry is pending, after it expired (derived, never a job)", () => {
    expect(deriveInvitationStatus(open, NOW)).toBe("pending");
    expect(deriveInvitationStatus({ ...open, expiresAt: new Date("2026-10-21T12:00:00Z") }, NOW)).toBe("expired");
    expect(deriveInvitationStatus({ ...open, expiresAt: new Date("2026-10-20T12:00:00Z") }, NOW)).toBe("expired");
  });

  it("each terminal timestamp wins over expiry", () => {
    const past = { expiresAt: new Date("2026-10-01T00:00:00Z") };
    expect(deriveInvitationStatus({ ...open, ...past, acceptedAt: NOW }, NOW)).toBe("accepted");
    expect(deriveInvitationStatus({ ...open, ...past, revokedAt: NOW }, NOW)).toBe("revoked");
    expect(deriveInvitationStatus({ ...open, ...past, blockedAt: NOW }, NOW)).toBe("blocked");
    expect(deriveInvitationStatus({ ...open, ...past, supersededAt: NOW }, NOW)).toBe("superseded");
  });
});

describe("deliveryState", () => {
  const base = { status: "queued", deliveredAt: null, bouncedAt: null };
  it("maps queue status and delivery events", () => {
    expect(deliveryState(null)).toBe("unknown");
    expect(deliveryState(base)).toBe("queued");
    expect(deliveryState({ ...base, status: "processing" })).toBe("queued");
    expect(deliveryState({ ...base, status: "sent" })).toBe("sent");
    expect(deliveryState({ ...base, status: "sent", deliveredAt: NOW })).toBe("delivered");
    expect(deliveryState({ ...base, status: "failed" })).toBe("failed");
    expect(deliveryState({ ...base, status: "cancelled" })).toBe("cancelled");
    expect(deliveryState({ ...base, status: "mystery" })).toBe("unknown");
  });
  it("a bounce outranks a delivery timestamp", () => {
    expect(deliveryState({ status: "sent", deliveredAt: NOW, bouncedAt: NOW })).toBe("bounced");
  });
});

describe("labels", () => {
  it("every blocked reason has operator copy and invitee copy, and nothing mentions account existence or sign-up", () => {
    for (const reason of ACCOUNT_INVITATION_BLOCKED_REASONS) {
      expect(BLOCKED_REASON_OPERATOR_COPY[reason], reason).toBeTruthy();
      expect(INVITEE_BLOCKED_COPY[reason], reason).toBeTruthy();
      expect(BLOCKED_REASON_OPERATOR_COPY[reason], reason).not.toMatch(/sign up|has no account|no account/i);
    }
    expect(Object.keys(BLOCKED_REASON_OPERATOR_COPY).sort()).toEqual([...ACCOUNT_INVITATION_BLOCKED_REASONS].sort());
    expect(Object.keys(INVITEE_BLOCKED_COPY).sort()).toEqual([...ACCOUNT_INVITATION_BLOCKED_REASONS].sort());
  });

  it("uses the agreed status and delivery vocabulary", () => {
    expect(INVITATION_STATUS_LABEL).toEqual({
      pending: "Pending", accepted: "Accepted", expired: "Expired", revoked: "Revoked", blocked: "Couldn't be completed",
    });
    expect(DELIVERY_STATE_LABEL.bounced).toBe("Bounced. Check the address");
  });
});
