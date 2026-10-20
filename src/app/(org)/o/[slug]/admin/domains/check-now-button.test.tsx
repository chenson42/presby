// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const checkDomainAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ checkDomainAction: (...a: unknown[]) => checkDomainAction(...a) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import type { CheckOutcome } from "@/lib/domains/service";
import { CheckNowButton } from "./check-now-button";
import { CHECK_OUTCOME_COPY } from "./outcome-copy";

afterEach(() => {
  cleanup();
  checkDomainAction.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  toast.info.mockReset();
});

const click = () => fireEvent.click(screen.getByRole("button", { name: /Check now|Checking/ }));

describe("CheckNowButton", () => {
  it("asks for the right claim and shows 'Checking…' (disabled) while it runs", async () => {
    let finish!: (v: unknown) => void;
    checkDomainAction.mockReturnValue(new Promise((r) => (finish = r)));
    render(<CheckNowButton slug="alder-creek" claimName="church-one.invalid" />);
    click();
    const busy = await screen.findByRole("button", { name: "Checking…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(checkDomainAction).toHaveBeenCalledWith("alder-creek", "church-one.invalid");
    finish({ ok: true, data: { outcome: "unchanged", checkedAt: "2030-01-01T00:00:00Z" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Check now" })).toBeTruthy());
  });

  const outcomes = Object.keys(CHECK_OUTCOME_COPY) as CheckOutcome[];
  it.each(outcomes)("outcome %s reads in plain English through the right toast", async (outcome) => {
    checkDomainAction.mockResolvedValue({ ok: true, data: { outcome, checkedAt: "2030-01-01T00:00:00Z" } });
    render(<CheckNowButton slug="alder-creek" claimName="church-one.invalid" />);
    click();
    const copy = CHECK_OUTCOME_COPY[outcome];
    await waitFor(() => expect(toast[copy.tone]).toHaveBeenCalledWith(copy.message));
  });

  it("a rate limit shows the server's 'Try again in N minutes'", async () => {
    checkDomainAction.mockResolvedValue({ ok: false, code: "rate_limited", error: "You've done that a lot just now. Try again in 4 minutes." });
    render(<CheckNowButton slug="alder-creek" claimName="church-one.invalid" />);
    click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You've done that a lot just now. Try again in 4 minutes."));
  });

  it("a thrown action is a human toast", async () => {
    checkDomainAction.mockRejectedValue(new Error("boom"));
    render(<CheckNowButton slug="alder-creek" claimName="church-one.invalid" />);
    click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("We couldn't check right now. Try again in a few minutes."));
  });

  it("is disabled before hydration (server render) and a 44px target", async () => {
    const { renderToString } = await import("react-dom/server");
    expect(renderToString(<CheckNowButton slug="a" claimName="b.invalid" />)).toMatch(/<button[^>]*disabled/);
    render(<CheckNowButton slug="a" claimName="b.invalid" />);
    expect(screen.getByRole("button").className).toMatch(/min-h-11/);
  });
});

describe("check outcome copy", () => {
  it("never shows provider vocabulary and every message is a sentence", () => {
    for (const [outcome, { message }] of Object.entries(CHECK_OUTCOME_COPY)) {
      expect(message, outcome).toMatch(/\.$/);
      expect(message, outcome).not.toMatch(/vercel|resend|api|500|error code|exception/i);
    }
  });
});
