/**
 * Tests for `GET /site/<slug>/sitemap.xml`. What this file exists to pin:
 *
 *   1. A slug `getPublishedSite()` can't resolve (never provisioned,
 *      suspended, nonexistent, or the render flag off — all collapsed
 *      identically) 404s, never a crash.
 *   2. On success: valid XML, one <url><loc> per bundle page that opts into
 *      nav (`frontMatter.navLabel` set — same signal `Nav` itself uses),
 *      each an absolute `/site/<slug>/...` URL. A page with no `navLabel`
 *      is excluded, per `buildSitemapEntries`'s own documented contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getPublishedSite = vi.fn();
vi.mock("@/lib/sites", () => ({
  getPublishedSite: (...args: unknown[]) => getPublishedSite(...args),
}));

import { GET } from "./route";

beforeEach(() => {
  getPublishedSite.mockReset();
});

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

describe("GET /site/<slug>/sitemap.xml", () => {
  it("404s when getPublishedSite() returns not_found", async () => {
    getPublishedSite.mockResolvedValue({ kind: "not_found" });

    const res = await GET(new Request("http://x/site/alder-creek/sitemap.xml"), makeParams("alder-creek"));

    expect(res.status).toBe(404);
  });

  it("returns one <url><loc> per bundle page, as absolute /site/<slug>/... urls, with the right content type", async () => {
    getPublishedSite.mockResolvedValue({
      kind: "ok",
      site: {
        pages: [
          { path: "/", frontMatter: { navLabel: "Home" }, mdxAst: null },
          { path: "/worship", frontMatter: { navLabel: "Worship" }, mdxAst: null },
        ],
      },
    });

    const res = await GET(new Request("http://x/site/alder-creek/sitemap.xml"), makeParams("alder-creek"));

    expect(res.headers.get("Content-Type")).toContain("application/xml");
    const body = await res.text();
    expect(body).toContain("<loc>http://localhost:3000/site/alder-creek</loc>");
    expect(body).toContain("<loc>http://localhost:3000/site/alder-creek/worship</loc>");
    expect(body.match(/<url>/g)?.length).toBe(2);
  });

  it("excludes a page with no frontMatter.navLabel", async () => {
    getPublishedSite.mockResolvedValue({
      kind: "ok",
      site: {
        pages: [
          { path: "/", frontMatter: { navLabel: "Home" }, mdxAst: null },
          { path: "/draft", frontMatter: {}, mdxAst: null },
        ],
      },
    });

    const res = await GET(new Request("http://x/site/alder-creek/sitemap.xml"), makeParams("alder-creek"));

    const body = await res.text();
    expect(body).toContain("<loc>http://localhost:3000/site/alder-creek</loc>");
    expect(body).not.toContain("/draft");
    expect(body.match(/<url>/g)?.length).toBe(1);
  });
});
