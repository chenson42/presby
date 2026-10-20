/**
 * Unit coverage for the Track F site-key resolver in `src/lib/sites.ts`:
 * `resolveSiteOrganization()` / `resolveSite()` / `resolveGiveSite()`
 * (docs/work-log/2026-10-19-custom-domains.md: DECISION-176, Phase 2 R1-R3,
 * adversarial A1-A3, A10). Pure-mock, like sites-render-fail-closed.test.ts:
 * `@/lib/db`, `@/lib/flags`, the blob store and `next/headers` are the edges.
 * `src/lib/domains/host.ts` and `src/lib/site-urls.ts` run for real. What this pins:
 *
 *   1. A HOST is a lookup key, not an identity: host mode refuses unless the request
 *      `Host` EQUALS the key and is not a platform host; slug mode refuses unless the
 *      request Host IS a platform host. Only `Host` is read - a spoofed
 *      `X-Forwarded-Host` / `Forwarded` changes nothing, in either direction.
 *   2. One flag read and one definer call per resolution, in every branch that reaches
 *      the database; every miss (and a DB blip) collapses to one `not_found` shape. A
 *      Host mismatch makes NO database read, so it is not a tenant oracle either.
 *   3. Everything absolute comes from the database row (the canonical host) and the
 *      validated platform origin, never from the request; `slug` is the row's.
 *   4. `redirectHost` is the canonical host for an alias, the serving host for the slug
 *      URL, and null otherwise; a malformed value from the row is ignored.
 *   5. The light resolution makes no blob fetch.
 */

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db", () => ({
  db: { execute: vi.fn() },
  getPlatformDb: vi.fn(),
}));

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args),
}));

const resolveBlob = vi.fn();
vi.mock("@/lib/storage/blob-store", () => ({
  getBlobStore: () => ({ resolve: (...args: unknown[]) => resolveBlob(...args) }),
}));

const mockHeaders = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: mockHeaders }));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resolveGiveSite, resolveSite, resolveSiteOrganization } from "./sites";

// A loosely-typed stand-in for the driver's `execute` (these tests hand back bare `{ rows }`).
const execute = db.execute as unknown as ReturnType<typeof vi.fn>;

const PLATFORM = "app.example.invalid";
const CUSTOM = "church-one.invalid";
const CANONICAL = "www.church-one.invalid";

function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((c) => (typeof c === "object" && c !== null && "value" in c ? (c as { value: string[] }).value.join("") : "?"))
    .join("");
}
function sqlParams(query: unknown): unknown[] {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks.filter((c) => !(typeof c === "object" && c !== null && "value" in c && Array.isArray((c as { value: unknown }).value)));
}

const BASE_ROW = {
  organization_id: "org-1",
  organization_name: "Alder Creek Presbyterian Church",
  organization_type: "congregation",
  content_bundle_key: "bundle-1",
  brand_seed_hex: null,
  brand_type_pairing: null,
  brand_token_version: null,
  brand_light_only: null,
  profile_address: null,
  profile_phone: null,
  profile_facebook_url: null,
  profile_instagram_url: null,
  profile_x_twitter_url: null,
  profile_youtube_url: null,
  profile_other_url: null,
  service_times: null,
  office_hours: null,
  serving_host: null as string | null,
};
const hostRow = (over: Record<string, unknown> = {}) => ({
  ...BASE_ROW,
  slug: "alder-creek",
  canonical_host: CANONICAL,
  request_is_canonical: true,
  serving_host: CANONICAL,
  ...over,
});
const BUNDLE = { schemaVersion: 1, pages: [{ path: "/", frontMatter: { title: "Home" }, mdxAst: null }], imageKeys: { hero: "blob-1" } };

/** `Host` for the request; extra headers (to prove they are ignored). */
function requestHeaders(host: string | null, extra: Record<string, string> = {}) {
  const h = new Headers(extra);
  if (host !== null) h.set("host", host);
  mockHeaders.mockResolvedValue(h);
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", `https://${PLATFORM}`);
  vi.stubEnv("NEXT_PUBLIC_PLATFORM_HOSTS", PLATFORM);
  vi.stubEnv("VERCEL_ENV", "");
  execute.mockReset();
  isFlagEnabled.mockReset();
  isFlagEnabled.mockResolvedValue(true);
  resolveBlob.mockReset();
  resolveBlob.mockResolvedValue({ bytes: Buffer.from(JSON.stringify(BUNDLE)), contentType: "application/json" });
  mockHeaders.mockReset();
  requestHeaders(CUSTOM);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const MISS_HOST = { kind: "not_found", mode: "host", slug: null } as const;

describe("host mode - the request Host must EQUAL the key", () => {
  it("resolves a live host through ONE flag read and ONE presby_published_site_by_host call", async () => {
    execute.mockResolvedValue({ rows: [hostRow()] });

    const r = await resolveSiteOrganization(CUSTOM);

    expect(r).toMatchObject({ kind: "ok", mode: "host", slug: "alder-creek", organizationId: "org-1" });
    expect(isFlagEnabled).toHaveBeenCalledTimes(1);
    expect(isFlagEnabled).toHaveBeenCalledWith("sites.public_render");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(sqlText(execute.mock.calls[0]![0])).toContain("presby_published_site_by_host");
    expect(sqlParams(execute.mock.calls[0]![0])).toEqual([CUSTOM]);
  });

  it("builds absolute URLs from the ROW's canonical host and the platform origin, never from the request", async () => {
    // The request arrives on an alias; the row says the canonical host is www.
    execute.mockResolvedValue({ rows: [hostRow({ request_is_canonical: false })] });

    const r = await resolveSiteOrganization(CUSTOM);

    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.urls.origin).toBe(`https://${CANONICAL}`);
    expect(r.urls.canonical("/about")).toBe(`https://${CANONICAL}/about`);
    expect(r.urls.page("/about")).toBe("/about");
    expect(r.urls.portal()).toBe(`https://${PLATFORM}/o/alder-creek`);
    expect(r.redirectHost).toBe(CANONICAL);
  });

  it("the canonical host serves itself: no redirect", async () => {
    requestHost(CANONICAL);
    execute.mockResolvedValue({ rows: [hostRow({ request_is_canonical: true })] });
    const r = await resolveSiteOrganization(CANONICAL);
    expect(r).toMatchObject({ kind: "ok", redirectHost: null });
  });

  it("a Host that differs from the key is a miss with NO database or flag read (adversarial A3)", async () => {
    requestHost("church-two.invalid");
    expect(await resolveSiteOrganization(CUSTOM)).toEqual(MISS_HOST);
    expect(execute).not.toHaveBeenCalled();
    expect(isFlagEnabled).not.toHaveBeenCalled();
  });

  it("a missing, unusable or non-ASCII Host is a miss with no read", async () => {
    for (const host of [null, "", "bad host", "-x.invalid", "a..b.invalid", "ex@mple.invalid"]) {
      requestHeaders(host);
      expect(await resolveSiteOrganization(CUSTOM), String(host)).toEqual(MISS_HOST);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("matches Host case-insensitively and ignoring the port and one trailing dot (it is the same host)", async () => {
    execute.mockResolvedValue({ rows: [hostRow()] });
    for (const host of [CUSTOM.toUpperCase(), `${CUSTOM}:3000`, `${CUSTOM}.`]) {
      requestHeaders(host);
      expect((await resolveSiteOrganization(CUSTOM)).kind, host).toBe("ok");
    }
  });

  it("a platform host can never be a site key", async () => {
    requestHost(PLATFORM);
    expect(await resolveSiteOrganization(PLATFORM)).toEqual(MISS_HOST);
    requestHost("preview-abc.vercel.app");
    expect(await resolveSiteOrganization("preview-abc.vercel.app")).toEqual(MISS_HOST);
    expect(execute).not.toHaveBeenCalled();
  });

  it("only Host is read: X-Forwarded-Host / Forwarded / X-Original-Host change nothing, in either direction (R3, A2)", async () => {
    execute.mockResolvedValue({ rows: [hostRow()] });

    // Host is the key; the forwarded headers lie. Still resolves.
    requestHeaders(CUSTOM, { "x-forwarded-host": "church-two.invalid", forwarded: "host=church-two.invalid", "x-original-host": "church-two.invalid" });
    expect((await resolveSiteOrganization(CUSTOM)).kind).toBe("ok");

    // Host is someone else; the forwarded headers claim the key. Still a miss, with no read.
    execute.mockClear();
    requestHeaders("church-two.invalid", { "x-forwarded-host": CUSTOM, forwarded: `host=${CUSTOM}`, "x-original-host": CUSTOM });
    expect(await resolveSiteOrganization(CUSTOM)).toEqual(MISS_HOST);
    expect(execute).not.toHaveBeenCalled();
  });

  it("the flag off is a miss before the definer read", async () => {
    isFlagEnabled.mockResolvedValue(false);
    expect(await resolveSiteOrganization(CUSTOM)).toEqual(MISS_HOST);
    expect(execute).not.toHaveBeenCalled();
  });

  it("zero rows (unknown, pending, lapsed, paused, released, toggle off, site dark - the database collapses them all) is a miss", async () => {
    execute.mockResolvedValue({ rows: [] });
    expect(await resolveSiteOrganization(CUSTOM)).toEqual(MISS_HOST);
  });

  it("every non-serving state costs the SAME reads: one flag, one function call (DECISION-040)", async () => {
    const reads: Array<[number, number]> = [];
    for (const result of [{ rows: [] }, { rows: [hostRow()] }, { rows: [hostRow({ slug: null })] }, { rows: [hostRow({ canonical_host: "bad host" })] }]) {
      execute.mockReset();
      isFlagEnabled.mockClear();
      execute.mockResolvedValue(result);
      await resolveSiteOrganization(CUSTOM);
      reads.push([isFlagEnabled.mock.calls.length, execute.mock.calls.length]);
    }
    expect(new Set(reads.map((r) => r.join(","))).size).toBe(1);
    expect(reads[0]).toEqual([1, 1]);
  });

  it("a corrupt row (no slug, a slug that is not a label, an invalid canonical host) is a miss, never a guess", async () => {
    for (const over of [{ slug: null }, { slug: "Not A Slug" }, { slug: "a.b" }, { canonical_host: null }, { canonical_host: "evil.invalid/x" }, { canonical_host: "UPPER.invalid" }]) {
      execute.mockResolvedValue({ rows: [hostRow(over)] });
      expect((await resolveSiteOrganization(CUSTOM)).kind, JSON.stringify(over)).toBe("not_found");
    }
  });

  it("a database failure is the same miss with reason read_failed, logging no SQL and no bound parameters", async () => {
    execute.mockRejectedValue(new Error(`Failed query: select * from presby_published_site_by_host($1)\nparams: ${CUSTOM}`));

    const r = await resolveSiteOrganization(CUSTOM);

    expect(r).toEqual({ ...MISS_HOST, reason: "read_failed" });
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toMatch(/Failed query|select \*|params:/);
    expect(logged).not.toContain(CUSTOM);
  });

  it("a request-context failure (headers() throws) is a miss, not a 500", async () => {
    mockHeaders.mockRejectedValue(new Error("headers() was called outside a request scope"));
    expect(await resolveSiteOrganization(CUSTOM)).toEqual({ ...MISS_HOST, reason: "read_failed" });
  });
});

describe("slug mode - the request Host must BE a platform host", () => {
  beforeEach(() => requestHost(PLATFORM));

  it("resolves a slug on a platform host through one flag read and one presby_published_site call", async () => {
    execute.mockResolvedValue({ rows: [{ ...BASE_ROW }] });

    const r = await resolveSiteOrganization("alder-creek");

    expect(r).toMatchObject({ kind: "ok", mode: "slug", slug: "alder-creek", organizationId: "org-1", redirectHost: null });
    expect(isFlagEnabled).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    const q = execute.mock.calls[0]![0];
    expect(sqlText(q)).toContain("presby_published_site(");
    expect(sqlText(q)).not.toContain("by_host");
    expect(sqlParams(q)).toEqual(["alder-creek"]);
    if (r.kind === "ok") {
      expect(r.urls.page("/about")).toBe("/site/alder-creek/about");
      expect(r.urls.origin).toBe(`https://${PLATFORM}`);
    }
  });

  it("loopback and *.vercel.app are platform hosts outside a production deployment", async () => {
    execute.mockResolvedValue({ rows: [{ ...BASE_ROW }] });
    for (const host of ["localhost:3000", "127.0.0.1:3000", "preview-abc.vercel.app"]) {
      requestHost(host);
      expect((await resolveSiteOrganization("alder-creek")).kind, host).toBe("ok");
    }
  });

  it("a slug request arriving on a church's own domain is a miss with NO read (a bypassed rewrite cannot show a slug there)", async () => {
    requestHost(CUSTOM);
    expect(await resolveSiteOrganization("alder-creek")).toEqual({ kind: "not_found", mode: "slug", slug: "alder-creek" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("a missing Host is a miss", async () => {
    requestHeaders(null);
    expect((await resolveSiteOrganization("alder-creek")).kind).toBe("not_found");
    expect(execute).not.toHaveBeenCalled();
  });

  it("the slug URL of an org whose custom host is serving carries redirectHost (HTML pages 307 to it)", async () => {
    execute.mockResolvedValue({ rows: [{ ...BASE_ROW, serving_host: CANONICAL }] });
    expect(await resolveSiteOrganization("alder-creek")).toMatchObject({ kind: "ok", redirectHost: CANONICAL });
  });

  it("a serving_host that is not a plain hostname is ignored: serve in place, no redirect", async () => {
    for (const bad of ["evil.invalid/x", "https://evil.invalid", "EVIL.invalid", "nodot", "", "a b.invalid"]) {
      execute.mockResolvedValue({ rows: [{ ...BASE_ROW, serving_host: bad }] });
      expect(await resolveSiteOrganization("alder-creek"), bad).toMatchObject({ kind: "ok", redirectHost: null });
    }
  });

  it("a slug miss keeps the slug (so DECISION-121's presbytery fallback can name it) and carries no reason", async () => {
    execute.mockResolvedValue({ rows: [] });
    expect(await resolveSiteOrganization("alder-creek")).toEqual({ kind: "not_found", mode: "slug", slug: "alder-creek" });
  });

  it("a DB failure on a slug keeps the slug and says read_failed (the follow-up summary read is skipped)", async () => {
    execute.mockRejectedValue(new Error("boom"));
    expect(await resolveSiteOrganization("alder-creek")).toEqual({
      kind: "not_found",
      mode: "slug",
      slug: "alder-creek",
      reason: "read_failed",
    });
  });
});

describe("an unusable key", () => {
  it("is a miss that touches neither the request nor the database", async () => {
    for (const key of ["", "Bad_Slug", "UPPER", "a b", "-x", "x-", "a..b", "a.b.", "http://x.invalid", "a/b", "church-one.invalid/x", "a".repeat(64), "%2e"]) {
      expect(await resolveSiteOrganization(key), JSON.stringify(key)).toEqual({ kind: "not_found", mode: "invalid", slug: null });
    }
    expect(mockHeaders).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(isFlagEnabled).not.toHaveBeenCalled();
  });
});

describe("resolveSite - the full resolution", () => {
  it("hydrates the bundle for a host key and returns the row's slug and a host-mode url builder", async () => {
    execute.mockResolvedValue({ rows: [hostRow()] });

    const r = await resolveSite(CUSTOM);

    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.slug).toBe("alder-creek");
    expect(r.site.pages).toEqual(BUNDLE.pages);
    expect(r.site.imageKeys).toEqual(BUNDLE.imageKeys);
    expect(r.urls.mode).toBe("host");
    expect(resolveBlob).toHaveBeenCalledWith({ organizationId: "org-1", key: "bundle-1" });
  });

  it("a missing blob, a corrupt bundle and no content key are all the same absent miss", async () => {
    execute.mockResolvedValue({ rows: [hostRow()] });
    resolveBlob.mockResolvedValueOnce(null);
    expect(await resolveSite(CUSTOM)).toEqual({ ...MISS_HOST, reason: "absent" });

    resolveBlob.mockResolvedValueOnce({ bytes: Buffer.from("not json"), contentType: "x" });
    expect(await resolveSite(CUSTOM)).toEqual({ ...MISS_HOST, reason: "absent" });

    execute.mockResolvedValue({ rows: [hostRow({ content_bundle_key: null })] });
    expect(await resolveSite(CUSTOM)).toEqual({ ...MISS_HOST, reason: "absent" });
  });

  it("a blob-store failure is a miss with read_failed, never a throw", async () => {
    execute.mockResolvedValue({ rows: [hostRow()] });
    resolveBlob.mockRejectedValue(new Error("blob store down"));
    expect(await resolveSite(CUSTOM)).toEqual({ ...MISS_HOST, reason: "read_failed" });
  });

  it("passes the light resolver's miss straight through", async () => {
    requestHost("church-two.invalid");
    expect(await resolveSite(CUSTOM)).toEqual(MISS_HOST);
    expect(resolveBlob).not.toHaveBeenCalled();
  });
});

describe("resolveSiteOrganization - the light resolution", () => {
  it("makes NO blob fetch (the asset route, the contact form and the give actions never need the bundle)", async () => {
    execute.mockResolvedValue({ rows: [hostRow()] });
    await resolveSiteOrganization(CUSTOM);
    expect(resolveBlob).not.toHaveBeenCalled();
  });
});

describe("resolveGiveSite - the give surface's key resolution", () => {
  it("host mode: the DB slug, the host-mode urls, the redirect host", async () => {
    execute.mockResolvedValue({ rows: [hostRow({ request_is_canonical: false })] });
    const t = await resolveGiveSite(CUSTOM);
    expect(t).toMatchObject({ slug: "alder-creek", redirectHost: CANONICAL });
    expect(t!.urls.give()).toBe("/give");
  });

  it("host mode that does not resolve is null (the caller 404s)", async () => {
    execute.mockResolvedValue({ rows: [] });
    expect(await resolveGiveSite(CUSTOM)).toBeNull();
    requestHost("church-two.invalid");
    expect(await resolveGiveSite(CUSTOM)).toBeNull();
  });

  it("slug mode keeps the give surface's pre-Track-F behaviour: a slug with no live site is still a usable key on a platform host", async () => {
    requestHost(PLATFORM);
    execute.mockResolvedValue({ rows: [] });
    const t = await resolveGiveSite("alder-creek");
    expect(t).toMatchObject({ slug: "alder-creek", redirectHost: null });
    expect(t!.urls.give()).toBe("/site/alder-creek/give");
  });

  it("...but never on a church's own domain, and never for an unusable key", async () => {
    requestHost(CUSTOM);
    execute.mockResolvedValue({ rows: [] });
    expect(await resolveGiveSite("alder-creek")).toBeNull();
    requestHost(PLATFORM);
    expect(await resolveGiveSite("Not_A_Slug")).toBeNull();
  });

  it("a slug whose site is serving on a custom host redirects (the give page 307s too)", async () => {
    requestHost(PLATFORM);
    execute.mockResolvedValue({ rows: [{ ...BASE_ROW, serving_host: CANONICAL }] });
    expect(await resolveGiveSite("alder-creek")).toMatchObject({ slug: "alder-creek", redirectHost: CANONICAL });
  });
});

/** Sets the request Host (helper kept below the tests that use it for readability). */
function requestHost(host: string) {
  requestHeaders(host);
}
