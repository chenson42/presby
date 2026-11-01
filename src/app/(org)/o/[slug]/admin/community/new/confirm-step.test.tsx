// @vitest-environment jsdom
/**
 * The wizard's already-here step (Increment 3a, Copy groups D and E): the
 * sentence for each connection, and Restore beside "Open their record" for an
 * archived candidate only. Mocked at the `../actions` boundary.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mockRestore = vi.hoisted(() => vi.fn());
vi.mock("../actions", () => ({
  restorePersonAction: (...a: unknown[]) => mockRestore(...a),
  changeEngagementAction: vi.fn(),
  archivePersonAction: vi.fn(),
  updateVisitDetailsAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

import { ConfirmStep } from "./confirm-step";
import type { Connection } from "@/lib/community-labels";

afterEach(() => {
  cleanup();
  for (const m of [mockRestore, toastSuccess, toastError]) m.mockReset();
});

const PERSON_ID = "11111111-1111-4111-8111-111111111111";
const RECORD = `/o/alder-creek/admin/community/${PERSON_ID}/edit`;

function renderStep(connection: Connection, endedOn: string | null, onRestored = vi.fn()) {
  render(
    <ConfirmStep
      displayName="Wren Alder"
      onConfirm={vi.fn()}
      onReject={vi.fn()}
      alreadyHere={{ connection, endedOn }}
      recordHref={RECORD}
      restore={{ slug: "alder-creek", personId: PERSON_ID, organization: "Alder Creek Presbyterian Church", onRestored }}
    />,
  );
  return onRestored;
}

describe("already-here sentences (Group E)", () => {
  it.each([
    ["inactive", null, "They're marked inactive."],
    ["moved_away", null, "They're marked as moved away."],
    ["unclassified", null, "They're already here."],
    ["listed", null, "They're listed here."],
    ["visitor", null, "They're a visitor."],
  ] as const)("%s", (connection, endedOn, sentence) => {
    renderStep(connection, endedOn);
    expect(screen.getByText(sentence)).toBeTruthy();
  });

  it("an archived person: 'They were archived on {date}.' with the date through <FormattedDate>, and no date when none", () => {
    const { container } = render(
      <ConfirmStep
        displayName="Wren Alder"
        onConfirm={vi.fn()}
        onReject={vi.fn()}
        alreadyHere={{ connection: "archived", endedOn: "2026-05-04" }}
        recordHref={RECORD}
      />,
    );
    expect(container.querySelector("time")).not.toBeNull();
    expect(container.textContent).toMatch(/They were archived on /);
    cleanup();
    renderStep("former_visitor", null);
    expect(screen.getByText("They were archived.")).toBeTruthy();
  });
});

describe("Restore in the wizard", () => {
  it.each(["archived", "former_visitor"] as const)("is offered beside 'Open their record' for a %s candidate, and Yes-this-is is not", (connection) => {
    renderStep(connection, "2026-05-04");
    expect(screen.getByRole("link", { name: "Open their record" }).getAttribute("href")).toBe(RECORD);
    expect(screen.getByRole("button", { name: "Restore Wren Alder" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^yes, this is/i })).toBeNull();
  });

  it.each(["inactive", "moved_away", "member", "listed", "visitor", "former_participant", "ended"] as const)(
    "is not offered for a %s candidate",
    (connection) => {
      renderStep(connection, null);
      expect(screen.queryByRole("button", { name: /^restore/i })).toBeNull();
    },
  );

  it("the dialog omits the connected line (the wizard never read it), names the list, and restores by person id", async () => {
    mockRestore.mockResolvedValue({ ok: true, data: { personId: PERSON_ID, list: "visitors" } });
    const onRestored = renderStep("former_visitor", "2026-05-04");
    fireEvent.click(screen.getByRole("button", { name: "Restore Wren Alder" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Restore Wren Alder?")).toBeTruthy();
    expect(within(dialog).getByText("Wren Alder will return to the Visitors list.")).toBeTruthy();
    expect(within(dialog).queryByText(/has a sign-in connected/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith("alder-creek", { personId: PERSON_ID }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Wren Alder is back on the Visitors list."));
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it("an archived inactive person returns to Inactive", () => {
    renderStep("archived", "2026-05-04");
    fireEvent.click(screen.getByRole("button", { name: "Restore Wren Alder" }));
    expect(screen.getByText("Wren Alder will return to the Inactive list.")).toBeTruthy();
  });

  it("a refusal keeps the dialog open and does not navigate", async () => {
    mockRestore.mockResolvedValue({ ok: false, error: "That person wasn't archived here." });
    const onRestored = renderStep("archived", "2026-05-04");
    fireEvent.click(screen.getByRole("button", { name: "Restore Wren Alder" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("That person wasn't archived here."));
    expect(onRestored).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});
