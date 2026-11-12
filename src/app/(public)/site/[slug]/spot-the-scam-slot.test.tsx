// @vitest-environment jsdom
/**
 * T9 - the `spotTheScam` live slot (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 T9;
 * DECISION-132, DECISION-154).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSiteUrls } from "@/lib/site-urls";

const readPublicLearn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/learn/public", () => ({
  readPublicLearn: (...a: unknown[]) => readPublicLearn(...a),
}));

import { PublicSpotTheScamSlot } from "./spot-the-scam-slot";

afterEach(() => {
  cleanup();
  readPublicLearn.mockReset();
});

const urls = buildSiteUrls({
  mode: "slug",
  slug: "alder-creek",
  platformOrigin: "https://presby.invalid",
});

async function renderSlot() {
  render(await PublicSpotTheScamSlot({ slug: "alder-creek", urls }));
}

describe("PublicSpotTheScamSlot - T9", () => {
  it("reads with the slug it was given and the closed key, and nothing else", async () => {
    readPublicLearn.mockResolvedValue({ state: "unavailable" });
    await renderSlot();
    expect(readPublicLearn).toHaveBeenCalledTimes(1);
    expect(readPublicLearn).toHaveBeenCalledWith("alder-creek", "org_portal.spot_the_scam");
  });

  it("unavailable and failed are the SAME notice, byte for byte (DECISION-154: the slot cannot tell the causes apart)", async () => {
    readPublicLearn.mockResolvedValue({ state: "unavailable" });
    await renderSlot();
    const first = screen.getByRole("region", {
      name: "Spot the scam",
    }).innerHTML;
    cleanup();
    readPublicLearn.mockResolvedValue({ state: "failed" });
    await renderSlot();
    expect(screen.getByRole("region", { name: "Spot the scam" }).innerHTML).toBe(first);
    expect(screen.getByTestId("spot-the-scam-unavailable").textContent).toBe(
      "Our scam-spotting practice isn't available right now. Please check back soon.",
    );
    expect(screen.queryByTestId("spot-the-scam-frame")).toBeNull();
  });

  it("available renders the frame with NO h1 (the host page owns it), the island and the six rules", async () => {
    readPublicLearn.mockResolvedValue({ state: "available" });
    await renderSlot();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByTestId("spot-the-scam-frame")).toBeTruthy();
    expect(screen.getByTestId("trainer")).toBeTruthy();
    expect(screen.getByTestId("rules-card")).toBeTruthy();
    expect(screen.queryByTestId("spot-the-scam-unavailable")).toBeNull();
  });

  it("renders no link at all (the slot builds no URL: nothing a bundle page could mis-point)", async () => {
    readPublicLearn.mockResolvedValue({ state: "available" });
    await renderSlot();
    expect(document.querySelectorAll("a, [href]")).toHaveLength(0);
  });

  it("two slots on one page do not collide on ids", async () => {
    readPublicLearn.mockResolvedValue({ state: "available" });
    render(
      <>
        {await PublicSpotTheScamSlot({ slug: "alder-creek", urls })}
        {await PublicSpotTheScamSlot({ slug: "alder-creek", urls })}
      </>,
    );
    expect(screen.getAllByTestId("trainer")).toHaveLength(2);
    // F-QA-1: no `id` may appear twice in the rendered output, and every aria-labelledby resolves.
    const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    for (const el of document.querySelectorAll("[aria-labelledby]")) {
      for (const ref of el.getAttribute("aria-labelledby")!.split(/\s+/)) {
        expect(document.getElementById(ref), `aria-labelledby="${ref}" resolves`).not.toBeNull();
      }
    }
    // Each region is named by ITS OWN heading, so the two sets of names stay identical to a single slot's.
    expect(screen.getAllByRole("region", { name: "Practice" })).toHaveLength(2);
    expect(screen.getAllByRole("region", { name: "The six rules to keep" })).toHaveLength(2);
  });
});
