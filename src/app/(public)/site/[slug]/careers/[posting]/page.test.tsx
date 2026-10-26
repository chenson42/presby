// @vitest-environment jsdom
/**
 * `/site/<key>/careers/<posting>` - one test per read state (docs/work-log/2026-10-25-careers-inc1.md,
 * Phase 3 T18): open, closed (noindex), failed (notice, noindex), and unavailable / not_found (the
 * site's one notFound()). The back link comes from the published bundle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { buildSiteUrls } from "@/lib/site-urls";

const readPublicPosting = vi.hoisted(() => vi.fn());
vi.mock("@/lib/careers/public", () => ({ readPublicPosting: (...a: unknown[]) => readPublicPosting(...a) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
const resolveSiteOrganization = vi.hoisted(() => vi.fn());
const resolveSite = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sites", () => ({
  resolveSiteOrganization: (...a: unknown[]) => resolveSiteOrganization(...a),
  resolveSite: (...a: unknown[]) => resolveSite(...a),
}));

import PublicPostingPage, { dynamic, generateMetadata } from "./page";

const slugOrg = (slug: string, redirectHost: string | null = null) => ({
  kind: "ok" as const,
  mode: "slug" as const,
  slug,
  organizationId: "org-1",
  urls: buildSiteUrls({ mode: "slug", slug, platformOrigin: "https://presby.invalid" }),
  redirectHost,
});

const POSTING = {
  slug: "music-director",
  title: "Music Director",
  location: "Sanctuary",
  employmentType: "part_time" as const,
  payMinCents: null,
  payMaxCents: null,
  payUnit: null,
  summary: "Lead the choir.",
  postedOn: "2026-11-03",
  closingDate: null,
  descriptionMd: "## About the role\n\nLead the choir.",
};
const OPEN = { state: "open" as const, organizationName: "Alder Creek", contactPhone: null, posting: POSTING };

const slotBundle = {
  kind: "ok" as const,
  site: { pages: [{ path: "/employment", mdxAst: { blocks: [{ type: "liveSlot", props: { slot: "careers" } }] } }] },
};

const page = (key: string, posting: string, search: Record<string, string> = {}) =>
  PublicPostingPage({ params: Promise.resolve({ slug: key, posting }), searchParams: Promise.resolve(search) });

beforeEach(() => {
  resolveSiteOrganization.mockImplementation(async (key: string) => slugOrg(key));
  resolveSite.mockResolvedValue({ kind: "not_found" });
});

afterEach(() => {
  cleanup();
  for (const mock of [resolveSiteOrganization, resolveSite, readPublicPosting]) mock.mockReset();
});

describe("PublicPostingPage - T18", () => {
  it("is never statically cached", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("open: renders the opening, reading with the database slug and the posting segment", async () => {
    readPublicPosting.mockResolvedValue(OPEN);
    render(await page("alder-creek", "music-director"));
    expect(readPublicPosting).toHaveBeenCalledWith("alder-creek", "music-director");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Music Director");
    expect(screen.getByTestId("how-to-apply")).toBeTruthy();
  });

  it("the 'All job openings' link goes to the first page carrying the slot", async () => {
    readPublicPosting.mockResolvedValue(OPEN);
    resolveSite.mockResolvedValue(slotBundle);
    render(await page("alder-creek", "music-director"));
    expect(screen.getByRole("link", { name: "All job openings" }).getAttribute("href")).toBe("/site/alder-creek/employment");
  });

  it("with no readable bundle it falls back to the platform list", async () => {
    readPublicPosting.mockResolvedValue(OPEN);
    resolveSite.mockRejectedValue(new Error("boom"));
    render(await page("alder-creek", "music-director"));
    expect(screen.getByRole("link", { name: "All job openings" }).getAttribute("href")).toBe("/site/alder-creek/careers");
  });

  it("closed: the title and the closed sentence only", async () => {
    readPublicPosting.mockResolvedValue({ state: "closed", organizationName: "Alder Creek", contactPhone: null, slug: "music-director", title: "Music Director" });
    render(await page("alder-creek", "music-director"));
    expect(screen.getByTestId("posting-closed").textContent).toContain("This position is no longer accepting applications.");
    expect(screen.queryByTestId("how-to-apply")).toBeNull();
  });

  it("failed: a notice at 200, never a 404 and never an empty page", async () => {
    readPublicPosting.mockResolvedValue({ state: "failed" });
    render(await page("alder-creek", "music-director"));
    expect(screen.getByTestId("careers-unavailable")).toBeTruthy();
  });

  it("unavailable and not_found are both the one notFound()", async () => {
    for (const state of ["unavailable", "not_found"]) {
      readPublicPosting.mockResolvedValue({ state });
      await expect(page("alder-creek", "x")).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("a site that does not resolve is notFound() and reads nothing", async () => {
    resolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "alder-creek" });
    await expect(page("alder-creek", "music-director")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(readPublicPosting).not.toHaveBeenCalled();
  });

  it("a slug URL of an org whose custom host is serving 307s to that host's posting URL", async () => {
    resolveSiteOrganization.mockResolvedValue(slugOrg("alder-creek", "church.example.invalid"));
    await expect(page("alder-creek", "music-director")).rejects.toThrow(
      "NEXT_REDIRECT:https://church.example.invalid/careers/music-director",
    );
    expect(readPublicPosting).not.toHaveBeenCalled();
  });
});

describe("generateMetadata - T18", () => {
  const meta = (key: string, posting: string) => generateMetadata({ params: Promise.resolve({ slug: key, posting }) });

  it("open: absolute title, the summary as description, the canonical posting URL", async () => {
    readPublicPosting.mockResolvedValue(OPEN);
    expect(await meta("alder-creek", "music-director")).toEqual({
      title: { absolute: "Music Director | Alder Creek" },
      description: "Lead the choir.",
      alternates: { canonical: "https://presby.invalid/site/alder-creek/careers/music-director" },
    });
  });

  it("closed and failed are noindex; unavailable adds nothing", async () => {
    readPublicPosting.mockResolvedValue({ state: "closed", organizationName: "Alder Creek", contactPhone: null, slug: "m", title: "Music Director" });
    expect((await meta("alder-creek", "m")).robots).toEqual({ index: false });
    readPublicPosting.mockResolvedValue({ state: "failed" });
    expect((await meta("alder-creek", "m")).robots).toEqual({ index: false });
    readPublicPosting.mockResolvedValue({ state: "unavailable" });
    expect(await meta("alder-creek", "m")).toEqual({});
  });
});
