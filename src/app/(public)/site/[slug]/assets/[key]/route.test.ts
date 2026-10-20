/**
 * Tests for `GET /site/<key>/assets/[key]` (and `GET /assets/[key]` on a church's
 * own domain) — the public, content-addressed asset route. What this file exists
 * to pin:
 *
 *   1. No session read anywhere — purely public.
 *   2. A key that `resolveSiteOrganization()` can't resolve (never
 *      provisioned, suspended, nonexistent, an unknown host, or the render flag
 *      off — all collapsed identically by that function) 404s, never a crash and
 *      never a distinguishable error.
 *   3. A key `getBlobStore().resolve()` can't find (wrong org, deleted,
 *      never existed) also 404s.
 *   4. On success: the exact bytes and content-type, plus a long-lived
 *      immutable Cache-Control header (content-addressed).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveSiteOrganization = vi.fn();
vi.mock("@/lib/sites", () => ({
  resolveSiteOrganization: (...args: unknown[]) => resolveSiteOrganization(...args),
}));

const resolveBlob = vi.fn();
vi.mock("@/lib/storage/blob-store", () => ({
  getBlobStore: () => ({ resolve: (...args: unknown[]) => resolveBlob(...args) }),
}));

import { GET } from "./route";

beforeEach(() => {
  resolveSiteOrganization.mockReset();
  resolveBlob.mockReset();
});

function makeParams(slug: string, key: string) {
  return { params: Promise.resolve({ slug, key }) };
}

/** A resolved organization, as `resolveSiteOrganization()` returns it. */
function found(over: Record<string, unknown> = {}) {
  return {
    kind: "ok",
    mode: "slug",
    slug: "alder-creek",
    organizationId: "org-1",
    urls: {},
    redirectHost: null,
    row: {},
    ...over,
  };
}

describe("GET /site/<slug>/assets/[key] — organization resolution", () => {
  it("404s when resolveSiteOrganization() finds nothing — never provisioned, suspended, or flag off, all identical", async () => {
    resolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "alder-creek" });

    const res = await GET(new Request("http://x/site/alder-creek/assets/k1"), {
      params: Promise.resolve({ slug: "alder-creek", key: "k1" }),
    });

    expect(res.status).toBe(404);
    expect(resolveBlob).not.toHaveBeenCalled();
  });
});

describe("GET /site/<slug>/assets/[key] — blob resolution", () => {
  it("404s when the blob store has nothing for that key", async () => {
    resolveSiteOrganization.mockResolvedValue(found());
    resolveBlob.mockResolvedValue(null);

    const res = await GET(
      new Request("http://x/site/alder-creek/assets/missing"),
      makeParams("alder-creek", "missing"),
    );

    expect(res.status).toBe(404);
  });

  it("404s (never crashes) when getBlobStore().resolve() throws — a DB blip on the blob_assets table, docs/work-log/2026-09-26-public-render-blip.md", async () => {
    resolveSiteOrganization.mockResolvedValue(found());
    resolveBlob.mockRejectedValue(new Error("simulated DB blip"));
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const res = await GET(
      new Request("http://x/site/alder-creek/assets/k1"),
      makeParams("alder-creek", "k1"),
    );

    expect(res.status).toBe(404);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(consoleErrorSpy.mock.calls[0]);
    expect(serialized).not.toMatch(/select|Failed query|params:/i);
    expect(serialized).toContain("alder-creek");
    expect(serialized).toContain("k1");

    consoleErrorSpy.mockRestore();
  });

  it("serves the bytes with the stored content-type and an immutable, long-lived Cache-Control", async () => {
    resolveSiteOrganization.mockResolvedValue(found());
    resolveBlob.mockResolvedValue({
      bytes: Buffer.from("fake-png-bytes"),
      contentType: "image/png",
    });

    const res = await GET(
      new Request("http://x/site/alder-creek/assets/k1"),
      makeParams("alder-creek", "k1"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.toString()).toBe("fake-png-bytes");

    expect(resolveBlob).toHaveBeenCalledWith({
      organizationId: "org-1",
      key: "k1",
    });
  });
});

describe("GET /assets/[key] on a church's own domain (host mode)", () => {
  it("resolves the host key, reads the blob for the DB-resolved organization, and serves it", async () => {
    resolveSiteOrganization.mockResolvedValue(found({ mode: "host" }));
    resolveBlob.mockResolvedValue({ bytes: Buffer.from("png"), contentType: "image/png" });

    const res = await GET(new Request("http://x/assets/k1"), makeParams("church-one.invalid", "k1"));

    expect(resolveSiteOrganization).toHaveBeenCalledWith("church-one.invalid");
    expect(res.status).toBe(200);
    expect(resolveBlob).toHaveBeenCalledWith({ organizationId: "org-1", key: "k1" });
  });

  it("NEVER redirects, even when the resolver says this URL is not canonical (R6: assets are content-addressed)", async () => {
    resolveSiteOrganization.mockResolvedValue(found({ mode: "host", redirectHost: "www.church-one.invalid" }));
    resolveBlob.mockResolvedValue({ bytes: Buffer.from("png"), contentType: "image/png" });

    const alias = await GET(new Request("http://x/assets/k1"), makeParams("church-one.invalid", "k1"));
    expect(alias.status).toBe(200);
    expect(alias.headers.get("Location")).toBeNull();

    resolveSiteOrganization.mockResolvedValue(found({ mode: "slug", redirectHost: "www.church-one.invalid" }));
    const viaSlug = await GET(new Request("http://x/site/alder-creek/assets/k1"), makeParams("alder-creek", "k1"));
    expect(viaSlug.status).toBe(200);
    expect(viaSlug.headers.get("Location")).toBeNull();
  });

  it("an unresolvable host is the same JSON 404 as an unknown slug and never touches the blob store", async () => {
    resolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "host", slug: null });
    const hostMiss = await GET(new Request("http://x/assets/k1"), makeParams("unclaimed.invalid", "k1"));

    resolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "nope" });
    const slugMiss = await GET(new Request("http://x/site/nope/assets/k1"), makeParams("nope", "k1"));

    expect(hostMiss.status).toBe(404);
    expect(await hostMiss.json()).toEqual(await slugMiss.json());
    expect(resolveBlob).not.toHaveBeenCalled();
  });
});
