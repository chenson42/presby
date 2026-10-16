// @vitest-environment jsdom
/**
 * `/site/<slug>/give/return` (docs/work-log/2026-10-15-online-giving.md, Flow 3 step
 * 4). The panel is chosen by presby's own rows, never by the query string; a
 * missing or repeated `session_id` is `unknown` without a database call; the page
 * is noindex and sends no referrer.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const readReturnState = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/public-config", () => ({ readReturnState: (...a: unknown[]) => readReturnState(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import PublicGiveReturnPage, { dynamic, metadata } from "./page";

const call = (slug: string, sp: Record<string, string | string[] | undefined>) =>
  PublicGiveReturnPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(sp) });

afterEach(() => {
  cleanup();
  readReturnState.mockReset();
});

describe("PublicGiveReturnPage", () => {
  it("is noindex, no-referrer and dynamic", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
    expect(dynamic).toBe("force-dynamic");
  });

  it("reads the state by slug and session id and renders that panel", async () => {
    readReturnState.mockResolvedValue({ state: "received", giftAmountCents: 2500, coveredCents: 0, fundName: "General Fund", frequency: "once", livemode: true });
    render(await call("alder-creek", { session_id: "cs_test_a1B2c3D4e5" }));
    expect(readReturnState).toHaveBeenCalledWith("alder-creek", "cs_test_a1B2c3D4e5");
    expect(screen.getByTestId("give-return-received")).toBeTruthy();
    expect(screen.getByTestId("give-return-gift").textContent).toBe("$25.00 to General Fund");
  });

  it.each([
    ["missing", {}],
    ["repeated", { session_id: ["cs_test_a1B2c3D4e5", "cs_test_zzzzzzzz"] }],
  ])("a %s session_id is the unknown panel and never reaches the database", async (_label, sp) => {
    render(await call("alder-creek", sp));
    expect(screen.getByTestId("give-return-unknown")).toBeTruthy();
    expect(readReturnState).not.toHaveBeenCalled();
  });

  it("the unknown panel is the same markup whatever the slug (nothing here depends on whether it is a tenant)", async () => {
    readReturnState.mockResolvedValue({ state: "unknown" });
    const html: string[] = [];
    for (const slug of ["no-such-church", "alder-creek"]) {
      const { container, unmount } = render(await call(slug, { session_id: "cs_test_a1B2c3D4e5" }));
      html.push(container.innerHTML.split(slug).join("SLUG"));
      unmount();
    }
    expect(html[0]).toBe(html[1]);
  });

  it("a database error is the error panel, which says the gift is unaffected", async () => {
    readReturnState.mockResolvedValue({ state: "error" });
    render(await call("alder-creek", { session_id: "cs_test_a1B2c3D4e5" }));
    expect(screen.getByTestId("give-return-error")).toBeTruthy();
    expect(screen.getByText(/Your gift is not affected/)).toBeTruthy();
  });

  it("a query string cannot mark anything paid: only the database's state picks the panel", async () => {
    readReturnState.mockResolvedValue({ state: "confirming", giftAmountCents: 2500, coveredCents: 0, fundName: "General Fund", frequency: "once", livemode: true });
    render(await call("alder-creek", { session_id: "cs_test_a1B2c3D4e5", status: "paid", payment_status: "succeeded" }));
    expect(screen.getByTestId("give-return-confirming")).toBeTruthy();
  });
});
