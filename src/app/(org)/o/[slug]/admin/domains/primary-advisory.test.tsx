// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { buildChecklist, primaryAdvisory } from "@/lib/domains/checklist";
import { FIXTURE_CTX, fixtureRow } from "@/lib/domains/checklist-fixtures";

const changeCanonicalAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ changeCanonicalAction: (...a: unknown[]) => changeCanonicalAction(...a) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PrimaryAdvisoryBanner } from "./primary-advisory";

afterEach(() => {
  cleanup();
  changeCanonicalAction.mockReset();
});

function advisory() {
  const groups = buildChecklist(
    [
      fixtureRow({ hostname: "www.church-one.invalid", state: "lapsed", webRole: "canonical" }),
      fixtureRow({ hostname: "www.other.invalid", claimName: "other.invalid", state: "live", webRole: "alias", id: "alias-id" }),
    ],
    FIXTURE_CTX,
  );
  return primaryAdvisory(groups)!;
}

describe("PrimaryAdvisoryBanner (tech-lead follow-up A)", () => {
  it("says the primary address isn't serving, names the live alias, and offers to make it primary", () => {
    render(<PrimaryAdvisoryBanner slug="alder-creek" advisory={advisory()} />);
    const banner = screen.getByTestId("primary-advisory");
    expect(banner.textContent).toMatch(/Your primary address, www\.church-one\.invalid, isn.t serving/);
    expect(banner.textContent).toMatch(/www\.other\.invalid is live/);
    expect(within(banner).getByRole("button", { name: "Make www.other.invalid primary" })).toBeTruthy();
  });

  it("confirming calls changeCanonicalAction for the LIVE alias, not the dark primary", async () => {
    changeCanonicalAction.mockResolvedValue({ ok: true });
    render(<PrimaryAdvisoryBanner slug="alder-creek" advisory={advisory()} />);
    fireEvent.click(screen.getByRole("button", { name: "Make www.other.invalid primary" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Make primary" }));
    await waitFor(() => expect(changeCanonicalAction).toHaveBeenCalledWith("alder-creek", "alias-id"));
  });
});
