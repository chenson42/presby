// @vitest-environment jsdom
/**
 * `/site/<key>/careers` state matrix (docs/work-log/2026-10-25-careers-inc1.md, Phase 3 T18):
 * a bundle's own /careers page wins whenever it exists; otherwise `available` -> the list (or the
 * empty notice), `unavailable` and a non-serving site -> the site's one notFound(), `failed` -> a
 * noindex notice at 200. A custom-host key hands off through redirectIfNeeded as /give does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { buildSiteUrls } from "@/lib/site-urls";

const readPublicCareers = vi.hoisted(() => vi.fn());
vi.mock("@/lib/careers/public", () => ({ readPublicCareers: (...a: unknown[]) => readPublicCareers(...a) }));
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
vi.mock("../render-site-page", () => ({
  renderSitePage: (...a: unknown[]) => renderSitePage(...a),
  siteBundleMetadata: (...a: unknown[]) => siteBundleMetadata(...a),
  siteBundleHasPage: (...a: unknown[]) => siteBundleHasPage(...a),
}));

import PublicCareersPage, { dynamic, generateMetadata } from "./page";

const slugOrg = (slug: string, redirectHost: string | null = null) => ({
  kind: "ok" as const,
  mode: "slug" as const,
  slug,
  organizationId: "org-1",
  urls: buildSiteUrls({ mode: "slug", slug, platformOrigin: "https://presby.invalid" }),
  redirectHost,
});
const hostOrg = (host: string, slug: string) => ({
  kind: "ok" as const,
  mode: "host" as const,
  slug,
  organizationId: "org-1",
  urls: buildSiteUrls({ mode: "host", host, slug, platformOrigin: "https://presby.invalid" }),
  redirectHost: null,
});

const posting = {
  slug: "custodian",
  title: "Custodian",
  location: "Main campus",
  employmentType: "full_time" as const,
  payMinCents: null,
  payMaxCents: null,
  payUnit: null,
  summary: "Care for the building.",
  postedOn: "2026-11-03",
  closingDate: null,
};
const AVAILABLE = { state: "available" as const, organizationName: "Alder Creek Presbyterian Church", contactPhone: "614-555-0123", orgToday: "2026-11-03", postings: [posting] };

const page = (key: string, search: Record<string, string> = {}) =>
  PublicCareersPage({ params: Promise.resolve({ slug: key }), searchParams: Promise.resolve(search) });

beforeEach(() => {
  resolveSiteOrganization.mockImplementation(async (key: string) => slugOrg(key));
  renderSitePage.mockResolvedValue({ kind: "miss" });
  siteBundleHasPage.mockResolvedValue(false);
});

afterEach(() => {
  cleanup();
  for (const mock of [resolveSiteOrganization, readPublicCareers, renderSitePage, siteBundleMetadata, siteBundleHasPage]) mock.mockReset();
});

describe("PublicCareersPage - T18", () => {
  it("is never statically cached (an unpublish must show on the next request)", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("available with postings renders the list under an h1, a back link and the organization name", async () => {
    readPublicCareers.mockResolvedValue(AVAILABLE);
    render(await page("alder-creek"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Job openings");
    expect(screen.getByText("Alder Creek Presbyterian Church", { selector: "p" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to Alder Creek Presbyterian Church/ }).getAttribute("href")).toBe("/site/alder-creek");
    expect(screen.getByRole("link", { name: /View this position/ }).getAttribute("href")).toBe("/site/alder-creek/careers/custodian");
    // Read with the database-returned slug.
    expect(readPublicCareers).toHaveBeenCalledWith("alder-creek");
  });

  it("available with no postings is the empty notice (a successful read), with the phone", async () => {
    readPublicCareers.mockResolvedValue({ ...AVAILABLE, postings: [] });
    render(await page("alder-creek"));
    expect(screen.getByTestId("careers-empty").textContent).toContain("You can also call us at 614-555-0123.");
  });

  it("a bundle's own /careers page wins whenever it exists - the list is never read", async () => {
    renderSitePage.mockResolvedValue({ kind: "page", node: <main data-testid="bundle-careers">own page</main> });
    readPublicCareers.mockResolvedValue(AVAILABLE);
    render(await page("alder-creek"));
    expect(screen.getByTestId("bundle-careers")).toBeTruthy();
    expect(renderSitePage).toHaveBeenCalledWith("alder-creek", "/careers", { presbyteryFallback: false });
    expect(readPublicCareers).not.toHaveBeenCalled();
    expect(screen.queryByText("Job openings")).toBeNull();
  });

  it("unavailable is notFound() - the site's one neutral 404", async () => {
    readPublicCareers.mockResolvedValue({ state: "unavailable" });
    await expect(page("alder-creek")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a site that does not resolve (not live, flag off, unknown host) is notFound() and reads nothing", async () => {
    resolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "alder-creek" });
    await expect(page("alder-creek")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(readPublicCareers).not.toHaveBeenCalled();
    expect(renderSitePage).not.toHaveBeenCalled();
  });

  it("failed is a notice (200), not a 404 and not an empty list", async () => {
    readPublicCareers.mockResolvedValue({ state: "failed" });
    render(await page("alder-creek"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Job openings");
    expect(screen.getByTestId("careers-unavailable").textContent).toContain("aren't available right now");
    expect(screen.queryByTestId("careers-empty")).toBeNull();
  });

  it("a custom-host key hands off through redirectIfNeeded (307 to the canonical host, keeping the query)", async () => {
    resolveSiteOrganization.mockResolvedValue(slugOrg("alder-creek", "church.example.invalid"));
    await expect(page("alder-creek", { a: "1" })).rejects.toThrow("NEXT_REDIRECT:https://church.example.invalid/careers?a=1");
    expect(readPublicCareers).not.toHaveBeenCalled();
  });

  it("on a custom host the links are clean paths and the database slug is what is read", async () => {
    resolveSiteOrganization.mockResolvedValue(hostOrg("church.example.invalid", "alder-creek"));
    readPublicCareers.mockResolvedValue(AVAILABLE);
    render(await page("church.example.invalid"));
    expect(readPublicCareers).toHaveBeenCalledWith("alder-creek");
    expect(screen.getByRole("link", { name: /View this position/ }).getAttribute("href")).toBe("/careers/custodian");
    expect(screen.getByRole("link", { name: /Back to/ }).getAttribute("href")).toBe("/");
  });
});

describe("generateMetadata - T18", () => {
  const meta = (key: string) => generateMetadata({ params: Promise.resolve({ slug: key }) });

  it("names the organization absolutely and the canonical URL on the resolved host", async () => {
    readPublicCareers.mockResolvedValue(AVAILABLE);
    expect(await meta("alder-creek")).toEqual({
      title: { absolute: "Job openings | Alder Creek Presbyterian Church" },
      alternates: { canonical: "https://presby.invalid/site/alder-creek/careers" },
    });
    resolveSiteOrganization.mockResolvedValue(hostOrg("church.example.invalid", "alder-creek"));
    expect((await meta("church.example.invalid")).alternates).toEqual({ canonical: "https://church.example.invalid/careers" });
  });

  it("a bundle's own page uses the bundle's metadata", async () => {
    siteBundleHasPage.mockResolvedValue(true);
    siteBundleMetadata.mockResolvedValue({ title: "own" });
    expect(await meta("alder-creek")).toEqual({ title: "own" });
    expect(readPublicCareers).not.toHaveBeenCalled();
  });

  it("failed is noindex; unavailable and a non-resolving site add nothing", async () => {
    readPublicCareers.mockResolvedValue({ state: "failed" });
    expect((await meta("alder-creek")).robots).toEqual({ index: false });
    readPublicCareers.mockResolvedValue({ state: "unavailable" });
    expect(await meta("alder-creek")).toEqual({});
    resolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "x" });
    expect(await meta("x")).toEqual({});
  });
});
