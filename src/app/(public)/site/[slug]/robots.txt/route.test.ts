/**
 * Tests for `GET /robots.txt` on a church's own domain (the proxy rewrites it to
 * `/site/<host>/robots.txt`). Phase 2 R6, G8, DECISION-178. What this pins:
 *
 *   1. host mode, canonical host: `Allow: /` and a Sitemap line naming the CANONICAL host
 *      from the verified row (never the request Host) - no `Disallow: /`, which is what the
 *      platform's own robots.ts says and would de-index a church;
 *   2. an alias 307s (no-store) to the canonical host's robots.txt;
 *   3. slug mode is a 404: on a platform host the platform's own robots.ts is the one robots file;
 *   4. every non-serving host is the same bare 404 as everywhere else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveSiteOrganization = vi.fn();
vi.mock("@/lib/sites", () => ({
  resolveSiteOrganization: (...args: unknown[]) => resolveSiteOrganization(...args),
}));

import { buildSiteUrls } from "@/lib/site-urls";
import { GET } from "./route";

beforeEach(() => {
  resolveSiteOrganization.mockReset();
});

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const hostOk = (canonical: string, redirectHost: string | null = null) => ({
  kind: "ok",
  mode: "host",
  slug: "alder-creek",
  organizationId: "org-1",
  urls: buildSiteUrls({ mode: "host", host: canonical, slug: "alder-creek", platformOrigin: "http://localhost:3000" }),
  redirectHost,
  row: {},
});

describe("GET /robots.txt - host mode", () => {
  it("allows everything and points at the canonical host's sitemap", async () => {
    resolveSiteOrganization.mockResolvedValue(hostOk("www.church-one.invalid"));

    const res = await GET(new Request("http://x/robots.txt"), params("www.church-one.invalid"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toBe("User-agent: *\nAllow: /\n\nSitemap: https://www.church-one.invalid/sitemap.xml\n");
    expect(body).not.toMatch(/Disallow/i);
    expect(body).not.toContain("/site/");
    expect(body).not.toContain("alder-creek");
    expect(resolveSiteOrganization).toHaveBeenCalledWith("www.church-one.invalid");
  });

  it("names the ROW's canonical host in the Sitemap line even on a request for an alias that did not redirect", async () => {
    // (An alias redirects; this proves the line is built from urls, not from the key, if it ever served.)
    resolveSiteOrganization.mockResolvedValue({ ...hostOk("www.church-one.invalid"), redirectHost: null });
    const body = await (await GET(new Request("http://x/robots.txt"), params("church-one.invalid"))).text();
    expect(body).toContain("Sitemap: https://www.church-one.invalid/sitemap.xml");
    expect(body).not.toContain("Sitemap: https://church-one.invalid");
  });

  it("an alias 307s to the canonical host's robots.txt with no-store, and sends no body", async () => {
    resolveSiteOrganization.mockResolvedValue(hostOk("www.church-one.invalid", "www.church-one.invalid"));

    const res = await GET(new Request("http://x/robots.txt"), params("church-one.invalid"));

    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toBe("https://www.church-one.invalid/robots.txt");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(await res.text()).toBe("");
  });
});

describe("GET /robots.txt - everything that is not a serving host", () => {
  it("slug mode is a 404: the platform's own robots.ts is the robots file on a platform host", async () => {
    resolveSiteOrganization.mockResolvedValue({
      ...hostOk("www.church-one.invalid"),
      mode: "slug",
      urls: buildSiteUrls({ mode: "slug", slug: "alder-creek", platformOrigin: "http://localhost:3000" }),
    });

    const res = await GET(new Request("http://x/site/alder-creek/robots.txt"), params("alder-creek"));

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  it("an unknown, pending, lapsed or paused host (the resolver's miss) is the same bare 404", async () => {
    resolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "host", slug: null });
    const a = await GET(new Request("http://x/robots.txt"), params("unclaimed.invalid"));
    resolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "host", slug: null, reason: "read_failed" });
    const b = await GET(new Request("http://x/robots.txt"), params("unclaimed.invalid"));

    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(await a.text()).toBe(await b.text());
  });
});
