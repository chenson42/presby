/**
 * Edge gate tests.
 *
 * What is worth pinning here is the boundary the file's shape invites people to
 * get wrong: /o/* is authenticated, active-checked and 2FA-gated at the Edge and
 * NOTHING else — no membership check, no PROTECTION_RULES entry (DECISION-035) —
 * and /orgs sits deliberately outside the 2FA gate even though it starts with
 * "/o".
 */
vi.mock("@/lib/auth/config", () => ({ edgeAuth: vi.fn() }));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { edgeAuth } from "@/lib/auth/config";
import { proxy } from "./proxy";
import { ADMIN_ROLE, FEATURES } from "@/lib/permissions";

const auth = vi.mocked(edgeAuth);

type SessionUser = {
  id?: string;
  isActive?: boolean;
  roles?: string[];
  features?: string[];
  twoFactorRequired?: boolean;
  twoFactorVerified?: boolean;
};

function signedIn(user: SessionUser = {}) {
  auth.mockResolvedValueOnce({
    user: { id: "u1", isActive: true, roles: [], features: [], ...user },
  } as unknown as Awaited<ReturnType<typeof edgeAuth>>);
}

function request(pathname: string) {
  return new NextRequest(new URL(pathname, "https://presby.example.invalid"));
}

beforeEach(() => {
  auth.mockReset();
});

describe("proxy — /o/* (the org portal)", () => {
  it("sends an unauthenticated visitor to /signin carrying the deep link", async () => {
    auth.mockResolvedValueOnce(null as unknown as Awaited<
      ReturnType<typeof edgeAuth>
    >);

    const res = await proxy(request("/o/alder-creek/roll"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/signin");
    expect(location.searchParams.get("callbackUrl")).toBe("/o/alder-creek/roll");
  });

  it("challenges 2FA before the org page renders", async () => {
    signedIn({ twoFactorRequired: true, twoFactorVerified: false });

    const res = await proxy(request("/o/alder-creek"));

    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/totp");
    expect(location.searchParams.get("callbackUrl")).toBe("/o/alder-creek");
  });

  it("admits a member with no platform role or feature at all", async () => {
    // The Edge does NOT authorize membership — that is resolveOrgContext() plus
    // withOrgContext() in the RSC layer. A PROTECTION_RULES entry here would
    // gate the tenant axis with a platform-axis claim and lock every ordinary
    // member out of their own congregation.
    signedIn({ roles: [], features: [] });

    const res = await proxy(request("/o/alder-creek"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("admits a verified user whose organization requires 2FA", async () => {
    signedIn({ twoFactorRequired: true, twoFactorVerified: true });

    const res = await proxy(request("/o/alder-creek"));

    expect(res.status).toBe(200);
  });

  it("bounces a deactivated user regardless of the org", async () => {
    signedIn({ isActive: false });

    const res = await proxy(request("/o/alder-creek"));

    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/signin");
    expect(location.searchParams.get("error")).toBe("deactivated");
  });
});

describe("proxy — the routes around it", () => {
  it("leaves /orgs outside the 2FA gate — it is not an org path", async () => {
    // "/orgs".startsWith("/o/") === false, deliberately: the chooser renders no
    // tenant data and is the one page a user with a lost or pending
    // organization can still reach.
    signedIn({ twoFactorRequired: true, twoFactorVerified: false });

    const res = await proxy(request("/orgs"));

    expect(res.status).toBe(200);
  });

  it("leaves /launch outside the 2FA gate — the destination carries it", async () => {
    signedIn({ twoFactorRequired: true, twoFactorVerified: false });

    const res = await proxy(request("/launch"));

    expect(res.status).toBe(200);
  });

  it("still gates /admin on 2FA", async () => {
    signedIn({
      twoFactorRequired: true,
      twoFactorVerified: false,
      roles: [ADMIN_ROLE],
    });

    const res = await proxy(request("/admin/users"));

    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/totp");
    expect(location.searchParams.get("callbackUrl")).toBe("/admin/users");
  });

  it("still sends a signed-in user without the feature to /access-pending", async () => {
    signedIn({ features: [FEATURES.ADMIN_DASHBOARD] });

    const res = await proxy(request("/admin/users"));

    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/access-pending");
    expect(location.searchParams.get("from")).toBe("/admin/users");
  });

  it("sends an unauthenticated visitor away from /no-organization", async () => {
    auth.mockResolvedValueOnce(null as unknown as Awaited<
      ReturnType<typeof edgeAuth>
    >);

    const res = await proxy(request("/no-organization"));

    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/signin");
    expect(location.searchParams.get("callbackUrl")).toBe("/no-organization");
  });
});

describe("proxy — /site/* (public organization websites, DECISION-085)", () => {
  it("admits an anonymous visitor to /site/<slug> with no redirect", async () => {
    // No signedIn()/auth mock call here on purpose — edgeAuth() must never be
    // consulted at all for this path. If it were, this test would still pass
    // (auth.mockReset() in beforeEach leaves it resolving undefined, which
    // itself would 307 to /signin) — the real assertion is res.status === 200
    // AND that this happens with zero auth() setup, unlike every other
    // describe block in this file.
    const res = await proxy(request("/site/alder-creek"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(auth).not.toHaveBeenCalled();
  });

  it("admits /site/<slug>/assets/<key>, a nested path under the bypass", async () => {
    const res = await proxy(request("/site/alder-creek/assets/some-key"));

    expect(res.status).toBe(200);
    expect(auth).not.toHaveBeenCalled();
  });

  it("does not bypass /siteX or other paths that merely start with the string", async () => {
    // startsWith("/site/") must not accidentally admit an unrelated route
    // that happens to share a prefix character sequence.
    auth.mockResolvedValueOnce(null as unknown as Awaited<
      ReturnType<typeof edgeAuth>
    >);

    const res = await proxy(request("/sitemap-builder"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/signin");
  });
});
