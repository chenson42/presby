import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const withOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  withOrgContext: (...args: unknown[]) => withOrgContext(...args),
}));
const orgFeatureEnabledInTx = vi.hoisted(() => vi.fn());
vi.mock("@/lib/org-features", () => ({
  orgFeatureEnabledInTx: (...args: unknown[]) => orgFeatureEnabledInTx(...args),
}));
vi.mock("@/lib/onboarding/org-invite", () => ({
  SIGN_IN_CONNECT_TOGGLE: "org_portal.sign_in_connect",
}));

import { getSelfConnectEnabled } from "./community-self-connect";

describe("getSelfConnectEnabled", () => {
  it("reads the toggle row the way the Sign-in card does (category axis off) inside the viewer's own context", async () => {
    withOrgContext.mockImplementation(async (_p: string, _o: string, fn: (tx: unknown) => unknown) => fn("tx"));
    orgFeatureEnabledInTx.mockResolvedValue(true);
    expect(await getSelfConnectEnabled("person-1", "org-1")).toBe(true);
    expect(withOrgContext).toHaveBeenCalledWith("person-1", "org-1", expect.any(Function));
    expect(orgFeatureEnabledInTx).toHaveBeenCalledWith("tx", "org-1", "org_portal.sign_in_connect", false);
  });

  it("answers false when the toggle is off", async () => {
    withOrgContext.mockImplementation(async (_p: string, _o: string, fn: (tx: unknown) => unknown) => fn("tx"));
    orgFeatureEnabledInTx.mockResolvedValue(false);
    expect(await getSelfConnectEnabled("person-1", "org-1")).toBe(false);
  });

  it("answers null, never false, when the read fails: the dialog then omits its auto-connect line", async () => {
    withOrgContext.mockRejectedValue(new Error("db down"));
    expect(await getSelfConnectEnabled("person-1", "org-1")).toBeNull();
  });
});
