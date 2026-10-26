/**
 * U3 - `GET /site/<key>/assets/[key]` (and `GET /assets/[key]` on a church's
 * own domain): the public asset route after F289 / DECISION-277
 * (docs/work-log/2026-10-25-public-asset-allowlist.md, Phase 3 "API Contract"
 * and "Test Plan" U3).
 *
 * The route serves a key only through `getBlobStore().resolvePublic()` - the
 * door onto `presby_public_site_asset()`. The blob-store mock below has ONE
 * method, `resolvePublic`; any other call (`resolve`, `store`, ...) is a
 * TypeError, so a regression to "resolve any blob key for the org" cannot pass.
 *
 * What this file pins:
 *
 *   1. Every miss - malformed key, site miss (slug and host mode), a key the
 *      door does not serve (a statement PDF, a ticket screenshot, the bundle
 *      JSON, a private or unlisted photo, a foreign-org key: all "zero rows"
 *      at this layer), and a thrown read - returns the SAME status, body bytes
 *      and full header set. DECISION-040: which keys exist, and why one is not
 *      served, is not observable.
 *   2. A malformed key makes no read of any kind and writes no console.error.
 *   3. A site miss never reaches the blob door.
 *   4. A read failure logs once, { mode, slug, key } only, never error text.
 *   5. A case variant of a uuid is the canonical key (no second path).
 *   6. A `site` hit: stored Content-Type, `public, max-age=31536000, immutable`,
 *      nosniff, exact bytes. A `roster` hit: exactly `private, max-age=86400`.
 *   7. Never a redirect (R6), never a session read (no `@/auth`, no cookies).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveSiteOrganization = vi.fn();
vi.mock("@/lib/sites", () => ({
  resolveSiteOrganization: (...args: unknown[]) => resolveSiteOrganization(...args),
}));

const resolvePublic = vi.fn();
vi.mock("@/lib/storage/blob-store", () => ({
  getBlobStore: () => ({ resolvePublic: (...args: unknown[]) => resolvePublic(...args) }),
}));

// A session or cookie read on this route is a defect: both throw if touched.
vi.mock("@/auth", () => ({
  auth: () => {
    throw new Error("the public asset route must not read a session");
  },
}));
vi.mock("next/headers", () => ({
  cookies: () => {
    throw new Error("the public asset route must not read cookies");
  },
  headers: () => {
    throw new Error("the public asset route must not read request headers");
  },
}));

import { GET } from "./route";

const KEY = "0f8fad5b-d9cb-469f-a165-70867728950e";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resolveSiteOrganization.mockReset();
  resolvePublic.mockReset();
  vi.restoreAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
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

/** Status, body bytes and every header, sorted: the whole observable response. */
async function shape(res: Response) {
  const headers = [...res.headers.entries()].sort(([a], [b]) => a.localeCompare(b));
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()).toString("utf8"), headers };
}

async function get(slug: string, key: string, path = "site/alder-creek/assets") {
  return GET(new Request(`http://x/${path}/${key}`), makeParams(slug, key));
}

describe("the neutral 404", () => {
  it("is exactly {\"error\":\"Not found\"}, no-store, nosniff, application/json", async () => {
    resolveSiteOrganization.mockResolvedValue(found());
    resolvePublic.mockResolvedValue(null);

    const res = await get("alder-creek", KEY);

    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"error":"Not found"}');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Type")).toContain("application/json");
  });

  it("every miss is byte-identical: status, body and the FULL header set", async () => {
    const misses: Array<[string, () => Promise<Response>]> = [
      ["malformed key: a word", () => get("alder-creek", "not-a-uuid")],
      ["malformed key: a path", () => get("alder-creek", "..%2f..%2fetc")],
      ["malformed key: a trailing newline", () => get("alder-creek", `${KEY}\n`)],
      ["malformed key: empty", () => get("alder-creek", "")],
      [
        "site miss, slug mode",
        async () => {
          resolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "alder-creek" });
          return get("alder-creek", KEY);
        },
      ],
      [
        "site miss, host mode",
        async () => {
          resolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "host", slug: null });
          return get("unclaimed.invalid", KEY, "assets");
        },
      ],
      [
        "the door serves nothing (a statement PDF, a ticket screenshot, the bundle JSON, a private or unlisted photo, a foreign-org key, a random uuid)",
        async () => {
          resolveSiteOrganization.mockResolvedValue(found());
          resolvePublic.mockResolvedValue(null);
          return get("alder-creek", KEY);
        },
      ],
      [
        "the read throws",
        async () => {
          resolveSiteOrganization.mockResolvedValue(found());
          resolvePublic.mockRejectedValue(new Error("simulated DB blip"));
          return get("alder-creek", KEY);
        },
      ],
    ];

    const shapes: Array<Awaited<ReturnType<typeof shape>>> = [];
    for (const [label, run] of misses) {
      resolveSiteOrganization.mockReset();
      resolvePublic.mockReset();
      const s = await shape(await run());
      expect(s.status, label).toBe(404);
      shapes.push(s);
    }
    for (const s of shapes) expect(s).toEqual(shapes[0]);
  });
});

describe("a malformed key", () => {
  it.each(["not-a-uuid", KEY.slice(1), `${KEY}0`, `{${KEY}}`, `urn:uuid:${KEY}`, ` ${KEY}`, `${KEY}\n`])(
    "%j: no site read, no blob read, no console.error",
    async (bad) => {
      const res = await get("alder-creek", bad);

      expect(res.status).toBe(404);
      expect(resolveSiteOrganization).not.toHaveBeenCalled();
      expect(resolvePublic).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    },
  );
});

describe("organization resolution", () => {
  it("a site that resolveSiteOrganization() cannot resolve 404s and never reaches the blob door", async () => {
    resolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "alder-creek" });

    const res = await get("alder-creek", KEY);

    expect(res.status).toBe(404);
    expect(resolvePublic).not.toHaveBeenCalled();
  });
});

describe("a key the door does not serve", () => {
  it("404s, and the door was asked exactly once, for the resolver's organization (never the request's host or slug)", async () => {
    resolveSiteOrganization.mockResolvedValue(found({ organizationId: "org-from-resolver" }));
    resolvePublic.mockResolvedValue(null);

    const res = await get("alder-creek", KEY);

    expect(res.status).toBe(404);
    expect(resolvePublic).toHaveBeenCalledTimes(1);
    expect(resolvePublic).toHaveBeenCalledWith({ organizationId: "org-from-resolver", key: KEY });
  });
});

describe("a read failure", () => {
  it("404s, logs once with exactly { mode, slug, key }, and never the error text", async () => {
    resolveSiteOrganization.mockResolvedValue(found());
    resolvePublic.mockRejectedValue(new Error("simulated DB blip: select * from blob_assets params: org-1"));

    const res = await get("alder-creek", KEY);

    expect(res.status).toBe(404);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [message, detail] = consoleError.mock.calls[0]!;
    expect(message).toBe("[site-assets] public asset read failed; treating as not found");
    expect(Object.keys(detail as object).sort()).toEqual(["key", "mode", "slug"]);
    expect(detail).toEqual({ mode: "slug", slug: "alder-creek", key: KEY });
    expect(JSON.stringify(consoleError.mock.calls[0])).not.toMatch(/select|Failed query|params:|simulated/i);
  });
});

describe("a case variant of a uuid", () => {
  it("reaches the door in canonical lowercase and gets the canonical response", async () => {
    resolveSiteOrganization.mockResolvedValue(found());
    resolvePublic.mockResolvedValue({ bytes: Buffer.from("png"), contentType: "image/png", cacheClass: "site" });

    const upper = await get("alder-creek", KEY.toUpperCase());
    const lower = await get("alder-creek", KEY);

    expect(resolvePublic).toHaveBeenNthCalledWith(1, { organizationId: "org-1", key: KEY });
    expect(upper.status).toBe(200);
    expect(await shape(upper)).toEqual(await shape(lower));
  });
});

describe("a hit", () => {
  it("site class: stored Content-Type, immutable year-long Cache-Control, nosniff, the exact bytes", async () => {
    resolveSiteOrganization.mockResolvedValue(found());
    resolvePublic.mockResolvedValue({ bytes: Buffer.from("fake-png-bytes"), contentType: "image/png", cacheClass: "site" });

    const res = await get("alder-creek", KEY);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("fake-png-bytes");
  });

  it("roster class: exactly 'private, max-age=86400' - no public, no immutable, no s-maxage", async () => {
    resolveSiteOrganization.mockResolvedValue(found());
    resolvePublic.mockResolvedValue({ bytes: Buffer.from("jpeg"), contentType: "image/jpeg", cacheClass: "roster" });

    const res = await get("alder-creek", KEY);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    const cc = res.headers.get("Cache-Control")!;
    expect(cc).toBe("private, max-age=86400");
    expect(cc).not.toMatch(/immutable|s-maxage|public/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("host mode and redirects", () => {
  it("resolves the host key, reads for the DB-resolved organization, and serves", async () => {
    resolveSiteOrganization.mockResolvedValue(found({ mode: "host" }));
    resolvePublic.mockResolvedValue({ bytes: Buffer.from("png"), contentType: "image/png", cacheClass: "site" });

    const res = await get("church-one.invalid", KEY, "assets");

    expect(resolveSiteOrganization).toHaveBeenCalledWith("church-one.invalid");
    expect(res.status).toBe(200);
    expect(resolvePublic).toHaveBeenCalledWith({ organizationId: "org-1", key: KEY });
  });

  it("NEVER redirects, even when the resolver says this URL is not canonical (R6)", async () => {
    resolvePublic.mockResolvedValue({ bytes: Buffer.from("png"), contentType: "image/png", cacheClass: "site" });

    resolveSiteOrganization.mockResolvedValue(found({ mode: "host", redirectHost: "www.church-one.invalid" }));
    const alias = await get("church-one.invalid", KEY, "assets");
    expect(alias.status).toBe(200);
    expect(alias.headers.get("Location")).toBeNull();

    resolveSiteOrganization.mockResolvedValue(found({ mode: "slug", redirectHost: "www.church-one.invalid" }));
    const viaSlug = await get("alder-creek", KEY);
    expect(viaSlug.status).toBe(200);
    expect(viaSlug.headers.get("Location")).toBeNull();
  });

  it("an unresolvable host is the same JSON 404 as an unknown slug", async () => {
    resolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "host", slug: null });
    const hostMiss = await get("unclaimed.invalid", KEY, "assets");

    resolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "nope" });
    const slugMiss = await get("nope", KEY, "site/nope/assets");

    expect(await shape(hostMiss)).toEqual(await shape(slugMiss));
    expect(resolvePublic).not.toHaveBeenCalled();
  });
});
