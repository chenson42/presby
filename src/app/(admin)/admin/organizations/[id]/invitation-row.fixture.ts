import type { InvitationListRow } from "@/lib/onboarding/issue";

/** Test-support: one `InvitationListRow` with every field defaulted (synthetic data only). */
export function invitationRow(overrides: Partial<InvitationListRow> = {}): InvitationListRow {
  return {
    id: "inv-1",
    purpose: "founding_administrator",
    email: "clerk@example.invalid",
    inviteeFirstName: "Marisol",
    inviteeLastName: "Quenby",
    inviteeDisplayName: "Marisol Quenby",
    personId: null,
    status: "pending",
    delivery: "sent",
    createdAt: new Date("2026-10-21T12:00:00.000Z"),
    expiresAt: new Date("2026-10-28T12:00:00.000Z"),
    acceptedAt: null,
    selfDesignated: false,
    blockedReason: null,
    resendCount: 0,
    canResendAt: null,
    ...overrides,
  };
}
