/**
 * Tests for `GET /site/<slug>/assets/[key]` — the public, content-addressed
 * asset route. What this file exists to pin:
 *
 *   1. No session read anywhere — purely public.
 *   2. A slug that `resolvePublishedOrganization()` can't resolve (never
 *      provisioned, suspended, nonexistent, or the render flag off — all
 *      collapsed identically by that function) 404s, never a crash and
 *      never a distinguishable error.
 *   3. A key `getBlobStore().resolve()` can't find (wrong org, deleted,
 *      never existed) also 404s.
 *   4. On success: the exact bytes and content-type, plus a long-lived
 *      immutable Cache-Control header (content-addressed).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolvePublishedOrganization = vi.fn();
vi.mock("@/lib/sites", () => ({
  resolvePublishedOrganization: (...args: unknown[]) =>
    resolvePublishedOrganization(...args),
}));

const resolveBlob = vi.fn();
vi.mock("@/lib/storage/blob-store", () => ({
  getBlobStore: () => ({ resolve: (...args: unknown[]) => resolveBlob(...args) }),
}));

import { GET } from "./route";

beforeEach(() => {
  resolvePublishedOrganization.mockReset();
  resolveBlob.mockReset();
});

function makeParams(slug: string, key: string) {
  return { params: Promise.resolve({ slug, key }) };
}

describe("GET /site/<slug>/assets/[key] — organization resolution", () => {
  it("404s when resolvePublishedOrganization() finds nothing — never provisioned, suspended, or flag off, all identical", async () => {
    resolvePublishedOrganization.mockResolvedValue(null);

    const res = await GET(new Request("http://x/site/alder-creek/assets/k1"), {
      params: Promise.resolve({ slug: "alder-creek", key: "k1" }),
    });

    expect(res.status).toBe(404);
    expect(resolveBlob).not.toHaveBeenCalled();
  });
});

describe("GET /site/<slug>/assets/[key] — blob resolution", () => {
  it("404s when the blob store has nothing for that key", async () => {
    resolvePublishedOrganization.mockResolvedValue({ organizationId: "org-1" });
    resolveBlob.mockResolvedValue(null);

    const res = await GET(
      new Request("http://x/site/alder-creek/assets/missing"),
      makeParams("alder-creek", "missing"),
    );

    expect(res.status).toBe(404);
  });

  it("serves the bytes with the stored content-type and an immutable, long-lived Cache-Control", async () => {
    resolvePublishedOrganization.mockResolvedValue({ organizationId: "org-1" });
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
