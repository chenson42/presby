// @vitest-environment jsdom
/**
 * The `giving` live slot (docs/work-log/2026-10-15-online-giving.md, G16). The
 * marker's `filter.fund` is author-typed and lower-trust: honoured only when it is
 * one of this organization's online funds. `absent` renders nothing at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DEFAULT_RATES } from "@/lib/giving/money";

const readPublicGivingConfig = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/public-config", () => ({ readPublicGivingConfig: (...a: unknown[]) => readPublicGivingConfig(...a) }));
vi.mock("./give/actions", () => ({ createPublicGiveSessionAction: Object.assign(vi.fn(), { bind: vi.fn(() => vi.fn()) }) }));

import { createPublicGiveSessionAction } from "./give/actions";
import { PublicGivingSlot } from "./public-giving-slot";

const FUND_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FUND_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LIVE = {
  state: "live" as const,
  organizationName: "Alder Creek Presbyterian Church",
  livemode: true,
  contactPhone: null,
  funds: [
    { id: FUND_A, name: "General Fund" },
    { id: FUND_B, name: "Building Fund" },
  ],
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

const slot = async (filter: Record<string, unknown>) => render((await PublicGivingSlot({ slug: "alder-creek", siteKey: "alder-creek", filter })) as React.ReactElement);

describe("PublicGivingSlot", () => {
  it("absent renders nothing - a slot must not announce that giving exists", async () => {
    readPublicGivingConfig.mockResolvedValue({ state: "absent" });
    const result = await PublicGivingSlot({ slug: "alder-creek", siteKey: "alder-creek", filter: {} });
    expect(result).toBeNull();
  });

  it("reads only by the slug it was given", async () => {
    readPublicGivingConfig.mockResolvedValue(LIVE);
    await slot({});
    expect(readPublicGivingConfig).toHaveBeenCalledWith("alder-creek");
  });

  it("live renders the form under an h2 (the host page owns the h1) with the first fund selected", async () => {
    readPublicGivingConfig.mockResolvedValue(LIVE);
    await slot({});
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Give to Alder Creek Presbyterian Church");
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect((screen.getByLabelText(/^Fund/) as HTMLSelectElement).value).toBe(FUND_A);
  });

  it("filter.fund preselects a fund that is online", async () => {
    readPublicGivingConfig.mockResolvedValue(LIVE);
    await slot({ fund: FUND_B });
    expect((screen.getByLabelText(/^Fund/) as HTMLSelectElement).value).toBe(FUND_B);
  });

  it.each([
    ["another organization's fund id", { fund: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }],
    ["a name instead of an id", { fund: "Building Fund" }],
    ["a non-string", { fund: 7 }],
    ["an object", { fund: { id: FUND_B } }],
    ["other keys only", { committee: "Missions" }],
  ])("filter.fund as %s is ignored: the first fund stays selected", async (_label, filter) => {
    readPublicGivingConfig.mockResolvedValue(LIVE);
    await slot(filter);
    expect((screen.getByLabelText(/^Fund/) as HTMLSelectElement).value).toBe(FUND_A);
  });

  it("unavailable renders the shared notice (h2) and no form", async () => {
    readPublicGivingConfig.mockResolvedValue({ state: "unavailable", organizationName: "Alder Creek Presbyterian Church", contactPhone: "614-555-0123" });
    const { container } = await slot({});
    expect(screen.getByTestId("giving-unavailable")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 })).toBeTruthy();
    expect(container.querySelector("form")).toBeNull();
  });

  it("namespaces its element ids so it can sit on a page beside another form", async () => {
    readPublicGivingConfig.mockResolvedValue(LIVE);
    const { container } = await slot({});
    expect(container.querySelector("#slot-give-amount")).toBeTruthy();
    expect(container.querySelector("#give-amount")).toBeNull();
  });
});

describe("PublicGivingSlot - the site key (Track F)", () => {
  it("reads giving for the DB-returned slug but binds the give action to the page's site KEY", async () => {
    readPublicGivingConfig.mockResolvedValue(LIVE);
    vi.mocked(createPublicGiveSessionAction.bind).mockClear();

    render((await PublicGivingSlot({ slug: "alder-creek", siteKey: "church-one.invalid", filter: {} })) as React.ReactElement);

    expect(readPublicGivingConfig).toHaveBeenCalledWith("alder-creek");
    expect(readPublicGivingConfig).not.toHaveBeenCalledWith("church-one.invalid");
    // `.bind(null, key)`: the server re-resolves this key (Host === key on a custom host).
    expect(createPublicGiveSessionAction.bind).toHaveBeenCalledWith(null, "church-one.invalid");
  });
});
