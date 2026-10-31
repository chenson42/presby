vi.mock("server-only", () => ({}));

const { redirectMock, authMock, cachedAuthMock, cachedReadMock, uncachedReadMock } =
  vi.hoisted(() => ({
    redirectMock: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
    authMock: vi.fn(),
    cachedAuthMock: vi.fn(),
    cachedReadMock: vi.fn(),
    uncachedReadMock: vi.fn(),
  }));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: cachedAuthMock }));
vi.mock("@/lib/nav-data", () => ({ cachedIsPlatformAdmin: cachedReadMock }));
vi.mock("@/lib/platform-admin", () => ({ readIsPlatformAdmin: uncachedReadMock }));

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkDeveloperApiRequest,
  readEntitled,
  readEntitledUncached,
  requireDeveloper,
  safeReturnTo,
} from "./guard";

const user = (extra: Record<string, unknown> = {}) => ({
  user: { id: "u1", ...extra },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the two read seams", () => {
  it("readEntitled is the header's memoized read; the uncached seam is the bare read", () => {
    expect(readEntitled).toBe(cachedReadMock);
    expect(readEntitledUncached).toBe(uncachedReadMock);
  });
});

describe("requireDeveloper", () => {
  it("signed out redirects to /signin with the literal path", async () => {
    cachedAuthMock.mockResolvedValue(null);
    await expect(requireDeveloper("/developer/tables/roll_actions")).rejects.toThrow(
      "NEXT_REDIRECT:/signin?callbackUrl=%2Fdeveloper%2Ftables%2Froll_actions",
    );
    expect(cachedReadMock).not.toHaveBeenCalled();
  });

  it("required and unverified redirects to /totp with the path, before any predicate read", async () => {
    cachedAuthMock.mockResolvedValue(
      user({ twoFactorRequired: true, twoFactorVerified: false }),
    );
    await expect(requireDeveloper("/developer/schema.json")).rejects.toThrow(
      "NEXT_REDIRECT:/totp?callbackUrl=%2Fdeveloper%2Fschema.json",
    );
    expect(cachedReadMock).not.toHaveBeenCalled();
  });

  it("an entitled viewer is ok", async () => {
    cachedAuthMock.mockResolvedValue(user());
    cachedReadMock.mockResolvedValue(true);
    await expect(requireDeveloper("/developer")).resolves.toBe("ok");
    expect(redirectMock).not.toHaveBeenCalled();
    expect(cachedReadMock).toHaveBeenCalledWith("u1");
  });

  it("a signed-in viewer who is not entitled is forbidden, with no redirect", async () => {
    cachedAuthMock.mockResolvedValue(user());
    cachedReadMock.mockResolvedValue(false);
    await expect(requireDeveloper("/developer")).resolves.toBe("forbidden");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("a failing predicate read is unavailable, with no redirect", async () => {
    cachedAuthMock.mockResolvedValue(user());
    cachedReadMock.mockRejectedValue(new Error("db down"));
    await expect(requireDeveloper("/developer")).resolves.toBe("unavailable");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects carry the sanitised path, never the hostile one", async () => {
    cachedAuthMock.mockResolvedValue(null);
    await expect(requireDeveloper("//evil.example")).rejects.toThrow(
      "NEXT_REDIRECT:/signin?callbackUrl=%2Fdeveloper",
    );
  });
});

describe("returnTo allow-list", () => {
  const cases: Array<[string, string]> = [
    ["/developer", "/developer"],
    ["/developer/data-model", "/developer/data-model"],
    ["/developer/tables/roll_actions", "/developer/tables/roll_actions"],
    ["/developer/schema.json", "/developer/schema.json"],
    ["/developer/erd/d-rolls", "/developer/erd/d-rolls"],
    // a normal name, percent-encoded by the page, is preserved
    ["/developer/tables/odd%20name", "/developer/tables/odd%20name"],
    // hostile or odd
    ["../../admin", "/developer"],
    ["/developer/../admin", "/developer"],
    ["/developer/tables/%2e%2e", "/developer"],
    ["/developer/tables/%2E%2E/admin", "/developer"],
    ["/developer/tables/%2e", "/developer"],
    ["/developer/tables/a%2Fb", "/developer"],
    ["/developer/tables/a%5Cb", "/developer"],
    ["/developer/tables/%zz", "/developer"],
    ["//evil.example", "/developer"],
    ["https://evil.example/developer", "/developer"],
    ["/developer\\tables", "/developer"],
    ["/developerx", "/developer"],
    ["/developer-x/tables", "/developer"],
    ["/developer/", "/developer"],
    ["/developer//tables", "/developer"],
    ["/developer/tables/a?x=1", "/developer"],
    ["/developer/tables/a#frag", "/developer"],
    ["", "/developer"],
    ["/admin", "/developer"],
  ];

  it.each(cases)("%s becomes %s", (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});

describe("checkDeveloperApiRequest", () => {
  it("reads the session with auth() (not the cached variant) and the uncached predicate", async () => {
    authMock.mockResolvedValue(user());
    uncachedReadMock.mockResolvedValue(true);
    await expect(checkDeveloperApiRequest()).resolves.toBe("ok");
    expect(cachedAuthMock).not.toHaveBeenCalled();
    expect(cachedReadMock).not.toHaveBeenCalled();
    expect(uncachedReadMock).toHaveBeenCalledWith("u1");
  });

  it("returns each verdict without redirecting", async () => {
    authMock.mockResolvedValue(null);
    await expect(checkDeveloperApiRequest()).resolves.toBe("signed_out");

    authMock.mockResolvedValue(
      user({ twoFactorRequired: true, twoFactorVerified: false }),
    );
    await expect(checkDeveloperApiRequest()).resolves.toBe("two_factor_required");

    authMock.mockResolvedValue(user());
    uncachedReadMock.mockResolvedValue(false);
    await expect(checkDeveloperApiRequest()).resolves.toBe("forbidden");

    uncachedReadMock.mockRejectedValue(new Error("db down"));
    await expect(checkDeveloperApiRequest()).resolves.toBe("unavailable");

    expect(redirectMock).not.toHaveBeenCalled();
  });
});
