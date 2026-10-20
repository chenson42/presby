/**
 * Test-only panel builders for the connection card / panel specs. Not imported
 * by any route. Invented values only.
 */
import type { ConnectionPanel, ConnectionView } from "@/lib/giving/connection";

export function connectionView(over: Partial<ConnectionView> = {}): ConnectionView {
  return {
    id: "conn-1",
    status: "active",
    livemode: false,
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
    cardEnabled: true,
    achEnabled: true,
    requirementsDue: false,
    disabledReason: null,
    payoutsAttestedAt: null,
    publicEnabledAt: null,
    disconnectedAt: null,
    disconnectedReason: null,
    lastStatusAt: "2026-10-15T12:00:00.000Z",
    createdAt: "2026-10-01T12:00:00.000Z",
    rates: { cardFeeBps: 290, cardFeeFixedCents: 30, achFeeBps: 80, achFeeCapCents: 500 },
    ...over,
  };
}

export function panelOf(state: ConnectionPanel["state"], over: Partial<ConnectionPanel> = {}, view: Partial<ConnectionView> = {}): ConnectionPanel {
  const hasConnection = state !== "none" && state !== "unconfigured";
  const connection = hasConnection
    ? connectionView({
        status: state as ConnectionView["status"],
        ...(state === "onboarding"
          ? { chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, cardEnabled: false, achEnabled: false }
          : {}),
        ...(state === "restricted" ? { chargesEnabled: false, payoutsEnabled: false, requirementsDue: true, disabledReason: "requirements.past_due" } : {}),
        ...(state === "disconnected"
          ? { chargesEnabled: false, payoutsEnabled: false, cardEnabled: false, achEnabled: false, disconnectedAt: "2026-10-10T12:00:00.000Z", disconnectedReason: "treasurer" as const }
          : {}),
        ...view,
      })
    : null;
  const missing: ConnectionPanel["readiness"]["missing"] = [];
  if (state !== "active") missing.push("connection_active");
  if ((over.onlineFundCount ?? 1) < 1) missing.push("online_fund");
  if (!connection?.payoutsAttestedAt) missing.push("payouts_attested");
  return {
    state,
    stripeConfigured: state !== "unconfigured",
    platformMode: "test",
    connection,
    onlineFundCount: 1,
    activeSchedules: 0,
    readiness: { missing, canGoPublic: missing.length === 0 },
    ...over,
  };
}
