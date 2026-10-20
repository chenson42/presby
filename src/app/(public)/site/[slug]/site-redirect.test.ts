/**
 * The host-level redirects (DECISION-178, R6). Always a 307 with no-store, never a
 * 301/308; the target is `https://` + a host the DATABASE returned + this request's
 * re-encoded path and query - and cannot name any other host (no open redirect).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));

import {
  encodeBundlePath,
  hostRedirectUrl,
  redirectIfNeeded,
  redirectResponse,
  toSearchString,
} from "./site-redirect";

beforeEach(() => {
  redirectMock.mockClear();
});

describe("encodeBundlePath", () => {
  it("re-encodes every segment and keeps the root as /", () => {
    expect(encodeBundlePath("/")).toBe("/");
    expect(encodeBundlePath("")).toBe("/");
    expect(encodeBundlePath("/about")).toBe("/about");
    expect(encodeBundlePath("/our staff/a&b")).toBe("/our%20staff/a%26b");
    expect(encodeBundlePath("/a?x=1#h")).toBe("/a%3Fx%3D1%23h");
  });

  it("collapses repeated slashes: the result never starts with // (a protocol-relative URL)", () => {
    expect(encodeBundlePath("//evil.invalid/x")).toBe("/evil.invalid/x");
    expect(encodeBundlePath("///")).toBe("/");
  });
});

describe("toSearchString", () => {
  it("builds ?k=v, repeats array keys, skips undefined, and is empty when there is nothing", () => {
    expect(toSearchString(undefined)).toBe("");
    expect(toSearchString({})).toBe("");
    expect(toSearchString({ a: undefined })).toBe("");
    expect(toSearchString({ a: "1", b: ["x", "y z"] })).toBe("?a=1&b=x&b=y+z");
  });
});

describe("hostRedirectUrl", () => {
  it("is https + host + encoded path + query", () => {
    expect(hostRedirectUrl("www.church-one.invalid", "/about", "?tab=2")).toBe("https://www.church-one.invalid/about?tab=2");
    expect(hostRedirectUrl("www.church-one.invalid", "/")).toBe("https://www.church-one.invalid/");
  });

  it("refuses anything that is not a plain hostname (a corrupt row cannot smuggle a path, port, userinfo or second host)", () => {
    for (const bad of [
      "evil.invalid/path",
      "evil.invalid:8443",
      "user@evil.invalid",
      "https://evil.invalid",
      "evil.invalid#x",
      "evil.invalid?x",
      "a.invalid\\b.invalid",
      "EVIL.invalid",
      "nodot",
      "",
    ]) {
      expect(hostRedirectUrl(bad, "/"), JSON.stringify(bad)).toBeNull();
    }
  });

  it("a hostile PATH cannot change the host", () => {
    for (const p of ["//evil.invalid", "/\\evil.invalid", "/../../evil.invalid", "/%2F%2Fevil.invalid", "/@evil.invalid"]) {
      const url = hostRedirectUrl("www.church-one.invalid", p)!;
      expect(new URL(url).host, p).toBe("www.church-one.invalid");
      expect(new URL(url).protocol).toBe("https:");
    }
  });
});

describe("redirectIfNeeded (pages)", () => {
  it("does nothing when there is no redirect host", () => {
    redirectIfNeeded({ redirectHost: null }, { path: "/about" });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("calls redirect() with the target", () => {
    expect(() => redirectIfNeeded({ redirectHost: "www.church-one.invalid" }, { path: "/about", search: "?x=1" })).toThrow(
      "REDIRECT:https://www.church-one.invalid/about?x=1",
    );
  });

  it("serves in place when the host is malformed instead of redirecting somewhere odd", () => {
    redirectIfNeeded({ redirectHost: "evil.invalid/x" }, { path: "/about" });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe("redirectResponse (route handlers)", () => {
  it("is null when there is nothing to do", () => {
    expect(redirectResponse({ redirectHost: null }, { path: "/sitemap.xml" })).toBeNull();
    expect(redirectResponse({ redirectHost: "evil.invalid/x" }, { path: "/sitemap.xml" })).toBeNull();
  });

  it("is a 307 (never 301/308) with Location and Cache-Control: no-store, and no body", async () => {
    const res = redirectResponse({ redirectHost: "www.church-one.invalid" }, { path: "/sitemap.xml" })!;
    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toBe("https://www.church-one.invalid/sitemap.xml");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("");
  });
});
