// @vitest-environment jsdom
/**
 * `/site/<key>/learn/spot-the-scam` state matrix (docs/work-log/2026-11-10-learn-inc1a.md,
 * Phase 3 T8; DECISION-332): a bundle's own page at exactly this path wins whenever it
 * exists; otherwise `available` -> the practice, `unavailable` and a non-serving site -> the
 * site's one notFound(), `failed` -> a noindex notice at 200. A custom-host key hands off
 * through redirectIfNeeded as /give and /careers do. The AVAILABLE page is INDEXED (operator
 * ruling 2026-11-11: it overrides the design's `index: false`); only the failed notice is not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { buildSiteUrls } from "@/lib/site-urls";

const readPublicLearn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/learn/public", () => ({ readPublicLearn: (...a: unknown[]) => readPublicLearn(...a) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
const resolveSiteOrganization = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sites", () => ({ resolveSiteOrganization: (...a: unknown[]) => resolveSiteOrganization(...a) }));
const renderSitePage = vi.hoisted(() => vi.fn());
const siteBundleMetadata = vi.hoisted(() => vi.fn());
const siteBundleHasPage = vi.hoisted(() => vi.fn());
vi.mock("../../render-site-page", () => ({
  renderSitePage: (...a: unknown[]) => renderSitePage(...a),
  siteBundleMetadata: (...a: unknown[]) => siteBundleMetadata(...a),
  siteBundleHasPage: (...a: unknown[]) => siteBundleHasPage(...a),
}));

import PublicSpotTheScamPage, { dynamic, generateMetadata } from "./page";

const NAME = "Alder Creek Presbyterian Church";
const row = (name = NAME) => ({ organization_name: name });
const slugOrg = (slug: string, redirectHost: string | null = null, name = NAME) => ({
  kind: "ok" as const,
  mode: "slug" as const,
  slug,
  organizationId: "org-1",
  urls: buildSiteUrls({ mode: "slug", slug, platformOrigin: "https://presby.invalid" }),
  redirectHost,
  row: row(name),
});
const hostOrg = (host: string, slug: string) => ({
  kind: "ok" as const,
  mode: "host" as const,
  slug,
  organizationId: "org-1",
  urls: buildSiteUrls({ mode: "host", host, slug, platformOrigin: "https://presby.invalid" }),
  redirectHost: null,
  row: row(),
});

const page = (key: string, search: Record<string, string> = {}) =>
  PublicSpotTheScamPage({ params: Promise.resolve({ slug: key }), searchParams: Promise.resolve(search) });

beforeEach(() => {
  resolveSiteOrganization.mockImplementation(async (key: string) => slugOrg(key));
  renderSitePage.mockResolvedValue({ kind: "miss" });
  siteBundleHasPage.mockResolvedValue(false);
});

afterEach(() => {
  cleanup();
  for (const mock of [resolveSiteOrganization, readPublicLearn, renderSitePage, siteBundleMetadata, siteBundleHasPage]) mock.mockReset();
});

describe("PublicSpotTheScamPage - T8", () => {
  it("is never statically cached (a toggle change must show on the next request)", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("available renders the h1, a back link by name to the site's home, the frame and the six rules", async () => {
    readPublicLearn.mockResolvedValue({ state: "available" });
    render(await page("alder-creek"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Spot the scam");
    expect(screen.getByRole("link", { name: `Back to ${NAME}` }).getAttribute("href")).toBe("/site/alder-creek");
    expect(screen.getByTestId("spot-the-scam-frame")).toBeTruthy();
    expect(screen.getByTestId("rules-card").textContent).toContain("The six rules to keep");
    expect(screen.getByTestId("trainer")).toBeTruthy();
    // Read with the database-returned slug and the closed key.
    expect(readPublicLearn).toHaveBeenCalledWith("alder-creek", "org_portal.spot_the_scam");
  });

  it("the only link on the page is the back link (the practice itself has none)", async () => {
    readPublicLearn.mockResolvedValue({ state: "available" });
    const { container } = render(await page("alder-creek"));
    expect([...container.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["/site/alder-creek"]);
  });

  it("the back link is print:hidden and wraps a very long organization name", async () => {
    resolveSiteOrganization.mockResolvedValue(slugOrg("alder-creek", null, "N".repeat(120)));
    readPublicLearn.mockResolvedValue({ state: "available" });
    render(await page("alder-creek"));
    const link = screen.getByRole("link", { name: /^Back to N+$/ });
    expect(link.className).toContain("print:hidden");
    expect(link.className).toContain("[overflow-wrap:anywhere]");
  });

  it("a bundle's own /learn/spot-the-scam page wins whenever it exists - the read is never made", async () => {
    renderSitePage.mockResolvedValue({ kind: "page", node: <main data-testid="bundle-own">own page</main> });
    readPublicLearn.mockResolvedValue({ state: "available" });
    render(await page("alder-creek"));
    expect(screen.getByTestId("bundle-own")).toBeTruthy();
    expect(renderSitePage).toHaveBeenCalledWith("alder-creek", "/learn/spot-the-scam", { presbyteryFallback: false });
    expect(readPublicLearn).not.toHaveBeenCalled();
    expect(screen.queryByTestId("spot-the-scam-frame")).toBeNull();
  });

  it("unavailable is notFound() - the site's one neutral 404", async () => {
    readPublicLearn.mockResolvedValue({ state: "unavailable" });
    await expect(page("alder-creek")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a site that does not resolve (not live, flag off, unknown host) is notFound() and reads and renders nothing", async () => {
    resolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "alder-creek" });
    await expect(page("alder-creek")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(readPublicLearn).not.toHaveBeenCalled();
    expect(renderSitePage).not.toHaveBeenCalled();
  });

  it("failed is the one notice (200, under the h1), not a 404 and not the practice", async () => {
    readPublicLearn.mockResolvedValue({ state: "failed" });
    render(await page("alder-creek"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Spot the scam");
    expect(screen.getByTestId("spot-the-scam-unavailable").textContent).toBe(
      "Our scam-spotting practice isn't available right now. Please check back soon.",
    );
    expect(screen.queryByTestId("spot-the-scam-frame")).toBeNull();
  });

  it("a custom-host key hands off through redirectIfNeeded (307 to the canonical host, keeping the query)", async () => {
    resolveSiteOrganization.mockResolvedValue(slugOrg("alder-creek", "church.example.invalid"));
    await expect(page("alder-creek", { a: "1" })).rejects.toThrow("NEXT_REDIRECT:https://church.example.invalid/learn/spot-the-scam?a=1");
    expect(readPublicLearn).not.toHaveBeenCalled();
    expect(renderSitePage).not.toHaveBeenCalled();
  });

  it("on a custom host the back link is the clean root and the database slug is what is read", async () => {
    resolveSiteOrganization.mockResolvedValue(hostOrg("church.example.invalid", "alder-creek"));
    readPublicLearn.mockResolvedValue({ state: "available" });
    render(await page("church.example.invalid"));
    expect(readPublicLearn).toHaveBeenCalledWith("alder-creek", "org_portal.spot_the_scam");
    expect(screen.getByRole("link", { name: /^Back to / }).getAttribute("href")).toBe("/");
  });

  it("reads no search parameter beyond handing the query to the redirect (nothing a visitor sends changes the page)", async () => {
    readPublicLearn.mockResolvedValue({ state: "available" });
    const withQuery = render(await page("alder-creek", { next: "https://evil.invalid", callbackUrl: "/x", redirect: "/y" }));
    // useId() differs per render; nothing else may.
    const normalize = (h: string) => h.replace(/_r_\d+_/g, "_r_");
    const html = normalize(withQuery.container.innerHTML);
    cleanup();
    readPublicLearn.mockResolvedValue({ state: "available" });
    const plain = render(await page("alder-creek"));
    expect(normalize(plain.container.innerHTML)).toBe(html);
    expect(html).not.toContain("evil.invalid");
  });
});

describe("generateMetadata - T8", () => {
  const meta = (key: string) => generateMetadata({ params: Promise.resolve({ slug: key }) });

  it("available: the absolute title, the canonical URL on the resolved host, INDEXABLE, and no data-detector auto-linking", async () => {
    readPublicLearn.mockResolvedValue({ state: "available" });
    expect(await meta("alder-creek")).toEqual({
      title: { absolute: `Spot the scam | ${NAME}` },
      alternates: { canonical: "https://presby.invalid/site/alder-creek/learn/spot-the-scam" },
      robots: { index: true, follow: true },
      formatDetection: { telephone: false, date: false, address: false, email: false },
    });
    resolveSiteOrganization.mockResolvedValue(hostOrg("church.example.invalid", "alder-creek"));
    expect((await meta("church.example.invalid")).alternates).toEqual({ canonical: "https://church.example.invalid/learn/spot-the-scam" });
  });

  it("available is explicitly indexable (operator ruling 2026-11-11: no `index: false`) - regression for the design's noindex", async () => {
    readPublicLearn.mockResolvedValue({ state: "available" });
    const robots = (await meta("alder-creek")).robots;
    expect(robots).toEqual({ index: true, follow: true });
    expect(JSON.stringify(robots)).not.toContain("false");
  });

  it("a bundle's own page uses the bundle's metadata and no read is made", async () => {
    siteBundleHasPage.mockResolvedValue(true);
    siteBundleMetadata.mockResolvedValue({ title: "own" });
    expect(await meta("alder-creek")).toEqual({ title: "own" });
    expect(readPublicLearn).not.toHaveBeenCalled();
  });

  it("failed is noindex (the notice is thin and says nothing about the page); unavailable and a non-resolving site add nothing", async () => {
    readPublicLearn.mockResolvedValue({ state: "failed" });
    expect(await meta("alder-creek")).toEqual({ title: { absolute: "Spot the scam" }, robots: { index: false } });
    readPublicLearn.mockResolvedValue({ state: "unavailable" });
    expect(await meta("alder-creek")).toEqual({});
    resolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "x" });
    expect(await meta("x")).toEqual({});
  });
});
