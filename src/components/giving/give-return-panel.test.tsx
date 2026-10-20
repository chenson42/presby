// @vitest-environment jsdom
/**
 * The return panels (docs/work-log/2026-10-15-online-giving.md, Flow 3/4/6, G18).
 * Pins: one panel per state, the amount and fund and nothing personal, the
 * Stripe receipt called a payment receipt and kept apart from the year-end
 * statement (never an "acknowledgment"), the monthly stop path, the test-mode
 * notice, and the poller mounted for `confirming` only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReturnState } from "@/lib/giving/public-config";
import { RETURN_COPY, RETURN_PANELS, TEST_MODE_DONOR_DETAIL } from "@/lib/giving/giving-copy";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/giving/public-config", () => ({}));

import { GiveReturnPanel } from "./give-return-panel";

afterEach(cleanup);

const gift = (state: "confirming" | "received" | "bank_pending" | "failed", over: Partial<Extract<ReturnState, { fundName: string }>> = {}): ReturnState => ({
  state,
  giftAmountCents: 3750,
  coveredCents: 0,
  fundName: "General Fund",
  frequency: "once",
  livemode: true,
  ...over,
});

function panel(state: ReturnState, retryHref?: string) {
  return render(
    <GiveReturnPanel state={state} giveHref="/site/s/give" homeHref="/site/s" homeLabel="Back to the church's website" retryHref={retryHref} />,
  );
}

describe("GiveReturnPanel", () => {
  it.each(["confirming", "received", "bank_pending", "failed", "unknown", "error"] as const)("renders the %s panel with its own heading and test id", (key) => {
    panel(key === "unknown" || key === "error" ? { state: key } : gift(key));
    expect(screen.getByTestId(`give-return-${key}`)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(RETURN_PANELS[key].heading);
    expect(screen.getByText(RETURN_PANELS[key].body)).toBeTruthy();
  });

  it("shows the amount and fund, and nothing that identifies a person", () => {
    const { container } = panel(gift("received"));
    expect(screen.getByTestId("give-return-gift").textContent).toBe("$37.50 to General Fund");
    expect(container.textContent).not.toMatch(/@|\bcs_|acct_|donor/i);
  });

  it("received: the Stripe receipt is a payment receipt, separate from the year-end statement - never an acknowledgment", () => {
    const { container } = panel(gift("received"));
    expect(container.textContent).toMatch(/payment receipt/i);
    expect(container.textContent).toMatch(/year-end giving statement/i);
    expect(container.textContent).not.toMatch(/acknowledg/i);
  });

  it("a monthly gift names the monthly amount and says how to stop it; a one-time gift does not", () => {
    const { unmount } = panel(gift("received", { frequency: "monthly" }));
    expect(screen.getByTestId("give-return-gift").textContent).toBe("$37.50 every month to General Fund");
    expect(screen.getByTestId("give-return-monthly").textContent).toBe(RETURN_COPY.monthlyStop);
    unmount();
    panel(gift("received"));
    expect(screen.queryByTestId("give-return-monthly")).toBeNull();
  });

  it("covered fees are shown as part of the total, in dollars", () => {
    panel(gift("received", { giftAmountCents: 10_000, coveredCents: 349 }));
    expect(screen.getByTestId("give-return-gift").textContent).toContain("Includes $3.49 toward processing fees. Total $103.49.");
  });

  it("confirming mounts the poller; no other state does", () => {
    const { unmount } = panel(gift("confirming"));
    expect(screen.getByText("Checking on your gift.")).toBeTruthy();
    unmount();
    panel(gift("received"));
    expect(screen.queryByText("Checking on your gift.")).toBeNull();
  });

  it("failed offers Give again; unknown offers Give again; received does not", () => {
    const { unmount } = panel(gift("failed"));
    expect(screen.getByRole("link", { name: RETURN_COPY.giveAgain }).getAttribute("href")).toBe("/site/s/give");
    expect(screen.queryByTestId("give-return-gift")).toBeNull();
    unmount();
    const second = panel({ state: "unknown" });
    expect(screen.getByRole("link", { name: RETURN_COPY.giveAgain })).toBeTruthy();
    second.unmount();
    panel(gift("received"));
    expect(screen.queryByRole("link", { name: RETURN_COPY.giveAgain })).toBeNull();
  });

  it("error says the gift is not affected, with a way to try again", () => {
    panel({ state: "error" }, "/site/s/give/return?session_id=cs_test_abc12345");
    expect(screen.getByText(/Your gift is not affected/)).toBeTruthy();
    expect(screen.getByRole("link", { name: RETURN_COPY.tryAgain }).getAttribute("href")).toBe("/site/s/give/return?session_id=cs_test_abc12345");
  });

  it("test-mode gifts say so in words", () => {
    panel(gift("received", { livemode: false }));
    expect(screen.getByTestId("giving-test-mode-badge").textContent).toContain(TEST_MODE_DONOR_DETAIL);
  });

  it("always offers a quiet way back", () => {
    panel({ state: "unknown" });
    expect(screen.getByRole("link", { name: "Back to the church's website" }).getAttribute("href")).toBe("/site/s");
  });
});
