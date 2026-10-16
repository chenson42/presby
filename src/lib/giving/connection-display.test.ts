import { describe, expect, it } from "vitest";
import { deriveDisplayState, isOpenState, primaryActionFor, type PanelLike } from "./connection-display";

const panel = (state: PanelLike["state"], c: Partial<NonNullable<PanelLike["connection"]>> | null = {}): PanelLike => ({
  state,
  connection: c === null ? null : { status: state, detailsSubmitted: false, requirementsDue: false, ...c },
});

describe("deriveDisplayState", () => {
  it("maps the six panel states", () => {
    expect(deriveDisplayState(panel("unconfigured", null))).toBe("unconfigured");
    expect(deriveDisplayState(panel("none", null))).toBe("not_started");
    expect(deriveDisplayState(panel("active"))).toBe("active");
    expect(deriveDisplayState(panel("restricted"))).toBe("restricted");
    expect(deriveDisplayState(panel("disconnected"))).toBe("disconnected");
  });

  it("splits onboarding into details-due and pending-verification", () => {
    expect(deriveDisplayState(panel("onboarding", { detailsSubmitted: false }))).toBe("details_due");
    expect(deriveDisplayState(panel("onboarding", { detailsSubmitted: true, requirementsDue: true }))).toBe("details_due");
    expect(deriveDisplayState(panel("onboarding", { detailsSubmitted: true, requirementsDue: false }))).toBe("pending_verification");
  });
});

describe("primaryActionFor / isOpenState", () => {
  it("gives each state its one primary action", () => {
    expect(primaryActionFor("not_started")).toBe("start");
    expect(primaryActionFor("details_due")).toBe("continue");
    expect(primaryActionFor("pending_verification")).toBe("refresh");
    expect(primaryActionFor("restricted")).toBe("continue");
    expect(primaryActionFor("active")).toBe("none");
    expect(primaryActionFor("disconnected")).toBe("reconnect");
    expect(primaryActionFor("unconfigured")).toBe("none");
  });

  it("only the four open states can be refreshed or disconnected", () => {
    expect(["not_started", "disconnected", "unconfigured"].some((s) => isOpenState(s as never))).toBe(false);
    expect(["details_due", "pending_verification", "restricted", "active"].every((s) => isOpenState(s as never))).toBe(true);
  });
});
