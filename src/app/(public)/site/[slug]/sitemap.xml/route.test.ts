/**
 * Tests for `GET /site/<key>/sitemap.xml` (and `GET /sitemap.xml` on a church's own
 * domain). What this file exists to pin:
 *
 *   0. (Track F) host mode lists CLEAN urls on the verified canonical host; the slug
 *      URL of an org whose custom host is serving, and a non-canonical alias, 307
 *      (with `no-store`) to the canonical host's sitemap.
 *   1. A key `resolveSite()` can't resolve (never provisioned,
 *      suspended, nonexistent, or the render flag off — all collapsed
 *      identically) 404s, never a crash.
 *   2. On success: valid XML, one <url><loc> per bundle page that opts into
 *      nav (`frontMatter.navLabel` set — same signal `Nav` itself uses),
 *      each an absolute `/site/<slug>/...` URL. A page with no `navLabel`
 *      is excluded, per `buildSitemapEntries`'s own documented contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveSite = vi.fn();
vi.mock("@/lib/sites", () => ({
  resolveSite: (...args: unknown[]) => resolveSite(...args),
}));

import { buildSiteUrls } from "@/lib/site-urls";
import { GET } from "./route";

beforeEach(() => {
  resolveSite.mockReset();
});

/** A slug-mode `ok` result, as `resolveSite("alder-creek")` returns it. */
function slugOk(pages: unknown[], redirectHost: string | null = null) {
  return {
    kind: "ok",
    mode: "slug",
    slug: "alder-creek",
    site: { pages },
    urls: buildSiteUrls({ mode: "slug", slug: "alder-creek", platformOrigin: "http://localhost:3000" }),
    redirectHost,
  };
}

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

describe("GET /site/<slug>/sitemap.xml", () => {
  it("404s when resolveSite() returns not_found", async () => {
    resolveSite.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "alder-creek" });

    const res = await GET(new Request("http://x/site/alder-creek/sitemap.xml"), makeParams("alder-creek"));

    expect(res.status).toBe(404);
  });

  it("returns one <url><loc> per bundle page, as absolute /site/<slug>/... urls, with the right content type", async () => {
    resolveSite.mockResolvedValue(
      slugOk([
        { path: "/", frontMatter: { navLabel: "Home" }, mdxAst: null },
        { path: "/worship", frontMatter: { navLabel: "Worship" }, mdxAst: null },
      ]),
    );

    const res = await GET(new Request("http://x/site/alder-creek/sitemap.xml"), makeParams("alder-creek"));

    expect(res.headers.get("Content-Type")).toContain("application/xml");
    const body = await res.text();
    expect(body).toContain("<loc>http://localhost:3000/site/alder-creek</loc>");
    expect(body).toContain("<loc>http://localhost:3000/site/alder-creek/worship</loc>");
    expect(body.match(/<url>/g)?.length).toBe(2);
  });

  it("excludes a page with no frontMatter.navLabel", async () => {
    resolveSite.mockResolvedValue(
      slugOk([
        { path: "/", frontMatter: { navLabel: "Home" }, mdxAst: null },
        { path: "/draft", frontMatter: {}, mdxAst: null },
      ]),
    );

    const res = await GET(new Request("http://x/site/alder-creek/sitemap.xml"), makeParams("alder-creek"));

    const body = await res.text();
    expect(body).toContain("<loc>http://localhost:3000/site/alder-creek</loc>");
    expect(body).not.toContain("/draft");
    expect(body.match(/<url>/g)?.length).toBe(1);
  });
});

describe("GET /sitemap.xml on a church's own domain (host mode)", () => {
  const hostOk = (canonical: string, redirectHost: string | null = null) => ({
    kind: "ok",
    mode: "host",
    slug: "alder-creek",
    site: {
      pages: [
        { path: "/", frontMatter: { navLabel: "Home" }, mdxAst: null },
        { path: "/worship", frontMatter: { navLabel: "Worship" }, mdxAst: null },
      ],
    },
    urls: buildSiteUrls({ mode: "host", host: canonical, slug: "alder-creek", platformOrigin: "http://localhost:3000" }),
    redirectHost,
  });

  it("lists CLEAN urls on the canonical host: no /site/ prefix, no slug, no platform origin", async () => {
    resolveSite.mockResolvedValue(hostOk("www.church-one.invalid"));

    const res = await GET(new Request("http://x/sitemap.xml"), makeParams("www.church-one.invalid"));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<loc>https://www.church-one.invalid/</loc>");
    expect(body).toContain("<loc>https://www.church-one.invalid/worship</loc>");
    expect(body).not.toContain("/site/");
    expect(body).not.toContain("alder-creek");
    expect(body).not.toContain("localhost");
    expect(resolveSite).toHaveBeenCalledWith("www.church-one.invalid");
  });

  it("an alias 307s to the canonical host's sitemap with no-store (never a 301/308)", async () => {
    resolveSite.mockResolvedValue(hostOk("www.church-one.invalid", "www.church-one.invalid"));

    const res = await GET(new Request("http://x/sitemap.xml"), makeParams("church-one.invalid"));

    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toBe("https://www.church-one.invalid/sitemap.xml");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(await res.text()).toBe("");
  });

  it("the slug URL of an org whose custom host is serving 307s to that host's sitemap", async () => {
    resolveSite.mockResolvedValue(slugOk([{ path: "/", frontMatter: { navLabel: "Home" }, mdxAst: null }], "www.church-one.invalid"));

    const res = await GET(new Request("http://x/site/alder-creek/sitemap.xml"), makeParams("alder-creek"));

    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toBe("https://www.church-one.invalid/sitemap.xml");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("a host that does not resolve is the same bare 404 as an unknown slug", async () => {
    resolveSite.mockResolvedValue({ kind: "not_found", mode: "host", slug: null });
    const hostMiss = await GET(new Request("http://x/sitemap.xml"), makeParams("unclaimed.invalid"));

    resolveSite.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "nope" });
    const slugMiss = await GET(new Request("http://x/site/nope/sitemap.xml"), makeParams("nope"));

    expect(hostMiss.status).toBe(404);
    expect(await hostMiss.text()).toBe(await slugMiss.text());
  });
});
