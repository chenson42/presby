// @vitest-environment jsdom
/**
 * `/site/<slug>/give` page state machine (docs/work-log/2026-10-15-online-giving.md,
 * Batch 4). `live` -> the form; `unavailable` -> the notice and never the form;
 * `absent` -> the platform's own notFound(), the SAME outcome for an unknown slug,
 * a non-tenant slug and a toggle-off organization (the database answers all three
 * with the one `absent` row, so the page must not branch on anything else).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DEFAULT_RATES } from "@/lib/giving/money";

const readPublicGivingConfig = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/public-config", () => ({ readPublicGivingConfig: (...a: unknown[]) => readPublicGivingConfig(...a) }));
vi.mock("./actions", () => ({ createPublicGiveSessionAction: Object.assign(vi.fn(), { bind: vi.fn(() => vi.fn()) }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

import PublicGivePage, { dynamic, generateMetadata } from "./page";

const params = (slug: string) => Promise.resolve({ slug });
const LIVE = {
  state: "live" as const,
  organizationName: "Alder Creek Presbyterian Church",
  livemode: true,
  contactPhone: "614-555-0123",
  funds: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "General Fund" }],
  cardEnabled: true,
  achEnabled: true,
  rates: DEFAULT_RATES,
  minAmountCents: 100,
  maxAmountCents: 2_500_000,
};

afterEach(() => {
  cleanup();
  readPublicGivingConfig.mockReset();
});

describe("PublicGivePage", () => {
  it("is never served from a shared cache (the page mints a per-request idempotency key)", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("live: a heading naming the congregation, the form, and the way back to the site", async () => {
    readPublicGivingConfig.mockResolvedValue(LIVE);
    render(await PublicGivePage({ params: params("alder-creek") }));
    expect(readPublicGivingConfig).toHaveBeenCalledWith("alder-creek");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Give to Alder Creek Presbyterian Church");
    expect(screen.getByTestId("give-form")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to Alder Creek Presbyterian Church/ }).getAttribute("href")).toBe("/site/alder-creek");
  });

  it("live: each request gets its own idempotency key", async () => {
    readPublicGivingConfig.mockResolvedValue(LIVE);
    const keys: string[] = [];
    for (let n = 0; n < 2; n += 1) {
      const { container, unmount } = render(await PublicGivePage({ params: params("alder-creek") }));
      keys.push((container.querySelector('input[name="idempotencyKey"]') as HTMLInputElement).value);
      unmount();
    }
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("unavailable: the notice with the church's phone, and no form at all", async () => {
    readPublicGivingConfig.mockResolvedValue({ state: "unavailable", organizationName: "Alder Creek Presbyterian Church", contactPhone: "614-555-0123" });
    const { container } = render(await PublicGivePage({ params: params("alder-creek") }));
    expect(screen.getByTestId("giving-unavailable")).toBeTruthy();
    expect(container.querySelector("form, input, button")).toBeNull();
  });

  it.each([
    ["an unknown slug", "no-such-church"],
    ["a non-tenant slug", "some-presbytery"],
    ["a toggle-off organization", "alder-creek"],
  ])("absent (%s): the same notFound(), identical whichever of the three it was", async (_label, slug) => {
    readPublicGivingConfig.mockResolvedValue({ state: "absent" });
    await expect(PublicGivePage({ params: params(slug) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("absent: the three cases reject with the very same error and add no title of their own", async () => {
    readPublicGivingConfig.mockResolvedValue({ state: "absent" });
    const errors: string[] = [];
    for (const slug of ["no-such-church", "some-presbytery", "alder-creek"]) {
      errors.push(String(await PublicGivePage({ params: params(slug) }).catch((e: unknown) => e)));
      expect(await generateMetadata({ params: params(slug) })).toEqual({});
    }
    expect(new Set(errors).size).toBe(1);
  });

  it("titles a live or unavailable page with the congregation's name", async () => {
    readPublicGivingConfig.mockResolvedValue(LIVE);
    expect(await generateMetadata({ params: params("alder-creek") })).toEqual({ title: { absolute: "Give to Alder Creek Presbyterian Church" } });
  });
});
