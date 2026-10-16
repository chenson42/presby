/**
 * GET /o/<slug>/admin/giving/connect/refresh - Stripe's refresh_url. It mints a
 * fresh onboarding link for the caller's OWN open connection and 307s to it;
 * everything else is a 307 back to the giving overview with a notice code.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const auth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => auth(...a) }));
const authz = vi.hoisted(() => ({ resolveOrgContext: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...a: unknown[]) => authz.resolveOrgContext(...a),
  OrgAccessError: class OrgAccessError extends Error {},
}));
const access = vi.hoisted(() => ({ loadGivingContext: vi.fn() }));
vi.mock("@/lib/giving/access", async () => {
  const pure = await import("@/lib/giving/access-pure");
  return { ...pure, loadGivingContext: (...a: unknown[]) => access.loadGivingContext(...a) };
});
const lib = vi.hoisted(() => ({ continueConnect: vi.fn() }));
vi.mock("@/lib/giving/connection", () => lib);

import { GET } from "./route";

const SESSION = { user: { id: "user-1", email: "tess.manager@example.invalid", twoFactorRequired: true, twoFactorVerified: true } };
const OK_ORG = { kind: "ok", org: { personId: "person-1", organizationId: "org-1", organizationType: "congregation" } };
const request = () => new Request("http://localhost:3000/o/alder-creek/admin/giving/connect/refresh");
const call = () => GET(request(), { params: Promise.resolve({ slug: "alder-creek" }) });
const location = (res: Response) => res.headers.get("location");

afterEach(() => {
  auth.mockReset();
  authz.resolveOrgContext.mockReset();
  access.loadGivingContext.mockReset();
  lib.continueConnect.mockReset();
});

function allowed() {
  auth.mockResolvedValue(SESSION);
  authz.resolveOrgContext.mockResolvedValue(OK_ORG);
  access.loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: false, record: false, manage: true } });
}

describe("the refresh handler", () => {
  it("307s to the freshly minted Stripe URL for a giving.manage holder", async () => {
    allowed();
    lib.continueConnect.mockResolvedValue({ kind: "redirect", url: "https://accounts.stripe.com/r/acct_fixture" });
    const res = await call();
    expect(res.status).toBe(307);
    expect(location(res)).toBe("https://accounts.stripe.com/r/acct_fixture");
    expect(lib.continueConnect).toHaveBeenCalledWith(
      { personId: "person-1", organizationId: "org-1", userId: "user-1", email: "tess.manager@example.invalid" },
      "alder-creek",
    );
  });

  it("sends a signed-out visitor to sign in with this URL as the callback; mints nothing", async () => {
    auth.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(307);
    expect(location(res)).toContain("/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fgiving%2Fconnect%2Frefresh");
    expect(lib.continueConnect).not.toHaveBeenCalled();
  });

  it("sends an unverified-2FA session to /totp (the Node-side R4 check); mints nothing", async () => {
    auth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: false } });
    const res = await call();
    expect(location(res)).toContain("/totp?callbackUrl=");
    expect(lib.continueConnect).not.toHaveBeenCalled();
  });

  it.each([
    ["not a member", { kind: "forbidden" }],
    ["membership ended", { kind: "ended" }],
    ["no such organization", { kind: "not-found" }],
  ])("%s goes back to the overview without revealing which", async (_label, resolved) => {
    auth.mockResolvedValue(SESSION);
    authz.resolveOrgContext.mockResolvedValue(resolved);
    const res = await call();
    expect(res.status).toBe(307);
    expect(location(res)).toBe("http://localhost:3000/o/alder-creek/admin/giving?connect=no_access");
    expect(lib.continueConnect).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "not_applicable" }],
    [{ kind: "toggle_off", canManageFeatures: false }],
    [{ kind: "forbidden" }],
    [{ kind: "ok", has: { view: true, record: true, manage: false } }],
  ])("%j (not a giving manager) is a no_access notice", async (context) => {
    auth.mockResolvedValue(SESSION);
    authz.resolveOrgContext.mockResolvedValue(OK_ORG);
    access.loadGivingContext.mockResolvedValue(context);
    const res = await call();
    expect(location(res)).toContain("connect=no_access");
    expect(lib.continueConnect).not.toHaveBeenCalled();
  });

  it("a database failure reading the gate is an 'unavailable' notice, never a pass", async () => {
    auth.mockResolvedValue(SESSION);
    authz.resolveOrgContext.mockResolvedValue(OK_ORG);
    access.loadGivingContext.mockRejectedValue(new Error("db down"));
    expect(location(await call())).toContain("connect=unavailable");
    expect(lib.continueConnect).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "no_connection" }, "no_connection"],
    [{ kind: "stripe_unconfigured" }, "unconfigured"],
    [{ kind: "provider_error" }, "refresh_failed"],
    [{ kind: "forbidden" }, "refresh_failed"],
  ])("%j -> notice %s", async (result, notice) => {
    allowed();
    lib.continueConnect.mockResolvedValue(result);
    const res = await call();
    expect(res.status).toBe(307);
    expect(location(res)).toBe(`http://localhost:3000/o/alder-creek/admin/giving?connect=${notice}`);
  });
});
