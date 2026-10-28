// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSiteUrls } from "@/lib/site-urls";

const readPublicCareers = vi.hoisted(() => vi.fn());
vi.mock("@/lib/careers/public", () => ({ readPublicCareers: (...a: unknown[]) => readPublicCareers(...a) }));

import { PublicCareersSlot } from "./careers-slot";

afterEach(() => {
  cleanup();
  readPublicCareers.mockReset();
});

const urls = buildSiteUrls({ mode: "slug", slug: "alder-creek", platformOrigin: "https://presby.invalid" });
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

async function renderSlot() {
  render(await PublicCareersSlot({ slug: "alder-creek", urls }));
}

describe("PublicCareersSlot - T17", () => {
  it("reads with the slug it was given and nothing else", async () => {
    readPublicCareers.mockResolvedValue({ state: "unavailable" });
    await renderSlot();
    expect(readPublicCareers).toHaveBeenCalledWith("alder-creek");
  });

  it("unavailable and failed are the SAME notice (DECISION-154)", async () => {
    readPublicCareers.mockResolvedValue({ state: "unavailable" });
    await renderSlot();
    const first = screen.getByRole("region", { name: "Job openings" }).innerHTML;
    cleanup();
    readPublicCareers.mockResolvedValue({ state: "failed" });
    await renderSlot();
    expect(screen.getByRole("region", { name: "Job openings" }).innerHTML).toBe(first);
    expect(screen.getByTestId("careers-unavailable").textContent).toBe(
      "Our job openings aren't available right now. Please check back soon.",
    );
  });

  it("an empty successful read says so, with the phone only when there is one", async () => {
    readPublicCareers.mockResolvedValue({ state: "available", organizationName: "Alder Creek", contactPhone: "614-555-0123", orgToday: "2026-11-03", postings: [] });
    await renderSlot();
    expect(screen.getByTestId("careers-empty").textContent).toContain("You can also call us at 614-555-0123.");
    expect(screen.queryByTestId("careers-unavailable")).toBeNull();
    cleanup();
    readPublicCareers.mockResolvedValue({ state: "available", organizationName: "Alder Creek", contactPhone: null, orgToday: "2026-11-03", postings: [] });
    await renderSlot();
    expect(screen.getByTestId("careers-empty").textContent).not.toContain("call us");
  });

  it("renders the cards with links from SiteUrls", async () => {
    readPublicCareers.mockResolvedValue({ state: "available", organizationName: "Alder Creek", contactPhone: null, orgToday: "2026-11-03", postings: [posting] });
    await renderSlot();
    expect(screen.getByRole("link", { name: /View this position/ }).getAttribute("href")).toBe(urls.careersPosting("custodian"));
    expect(screen.queryByTestId("careers-empty")).toBeNull();
  });

  it("in host mode its links are clean paths", async () => {
    const hostUrls = buildSiteUrls({ mode: "host", host: "church.example.invalid", slug: "alder-creek", platformOrigin: "https://presby.invalid" });
    readPublicCareers.mockResolvedValue({ state: "available", organizationName: "Alder Creek", contactPhone: null, orgToday: "2026-11-03", postings: [posting] });
    render(await PublicCareersSlot({ slug: "alder-creek", urls: hostUrls }));
    expect(screen.getByRole("link", { name: /View this position/ }).getAttribute("href")).toBe("/careers/custodian");
  });
});
