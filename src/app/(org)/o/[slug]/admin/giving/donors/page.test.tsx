// @vitest-environment jsdom
/**
 * `/o/<slug>/admin/giving/donors` page (docs/work-log/2026-10-15-online-giving.md,
 * Batch 2 and S4): the full list for giving.view, the REDUCED variant (a name
 * search whose results are names only) for giving.record alone, the
 * suggestions and duplicates panels, and who can add a donor.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const gate = vi.fn();
vi.mock("../giving-page-gate", () => ({ gateGivingPage: (...a: unknown[]) => gate(...a) }));
const lib = vi.hoisted(() => ({ listDonors: vi.fn(), listPossibleDuplicates: vi.fn(), listWaitingLinkSuggestions: vi.fn(), searchDonors: vi.fn() }));
vi.mock("@/lib/giving/donors", () => lib);
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({ OrgAccessError }));
vi.mock("./donor-form", () => ({ DonorForm: () => <div data-testid="donor-form" /> }));

import GivingDonorsPage from "./page";

const org = { personId: "p1", organizationId: "o1", name: "Alder Creek Presbyterian Church", organizationType: "congregation", slug: "alder-creek" };
const viewer = { ok: true, userId: "u1", org, has: { view: true, record: false, manage: false } };
const recorder = { ok: true, userId: "u1", org, has: { view: false, record: true, manage: false } };
const props = (search: Record<string, string> = {}) => ({ params: Promise.resolve({ slug: "alder-creek" }), searchParams: Promise.resolve(search) });
const row = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, displayName: name, kind: "identified", email: `${id}@example.invalid`, location: "Dover, DE", linkedMemberName: null, ...over });

function arrangeViewer() {
  gate.mockResolvedValue(viewer);
  lib.listWaitingLinkSuggestions.mockResolvedValue({ kind: "ok", suggestions: [] });
  lib.listDonors.mockResolvedValue({ kind: "ok", donors: [row("d1", "Aurelia Pennington")], nextCursor: null });
  lib.listPossibleDuplicates.mockResolvedValue({ kind: "ok", pairs: [] });
}

afterEach(() => {
  cleanup();
  gate.mockReset();
  for (const fn of Object.values(lib)) fn.mockReset();
});

describe("the full list (giving.view)", () => {
  it("opens the gate to view OR record, reads the list with the search and cursor, and shows contact detail", async () => {
    arrangeViewer();
    render(await GivingDonorsPage(props({ q: " aurelia ", cursor: "abc" })));
    expect(gate).toHaveBeenCalledWith(expect.objectContaining({ anyOf: ["view", "record"], path: "/o/alder-creek/admin/giving/donors" }));
    expect(lib.listDonors).toHaveBeenCalledWith("p1", "o1", { q: "aurelia", cursor: "abc" });
    expect(screen.getByText("Aurelia Pennington")).toBeTruthy();
    expect(screen.getByText(/d1@example\.invalid · Dover, DE/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Search results" })).toBeTruthy();
    expect(lib.searchDonors).not.toHaveBeenCalled();
  });

  it("shows the possible-duplicates panel and the member-suggestions panel when there is something to review", async () => {
    arrangeViewer();
    lib.listPossibleDuplicates.mockResolvedValue({ kind: "ok", pairs: [{ aId: "a", aName: "Twin A", bId: "b", bName: "Twin B", reason: "same_email" }] });
    lib.listWaitingLinkSuggestions.mockResolvedValue({ kind: "ok", suggestions: [{ donorId: "d9", donorName: "W. Ashgrove", membershipId: "m1", personName: "Winifred Ashgrove" }] });
    render(await GivingDonorsPage(props()));
    expect(screen.getByRole("heading", { name: "Possible duplicates" })).toBeTruthy();
    expect(screen.getByText("Same email address")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Member suggestions" })).toBeTruthy();
    expect(screen.getByText("Looks like Winifred Ashgrove")).toBeTruthy();
    expect(screen.getByRole("link", { name: "W. Ashgrove" }).getAttribute("href")).toBe("/o/alder-creek/admin/giving/donors/d9");
  });

  it("empty: a designed state; a viewer without record gets no add form", async () => {
    arrangeViewer();
    lib.listDonors.mockResolvedValue({ kind: "ok", donors: [], nextCursor: null });
    render(await GivingDonorsPage(props()));
    expect(screen.getByText("No donors yet")).toBeTruthy();
    expect(screen.queryByTestId("donor-form")).toBeNull();
  });

  it("a next cursor becomes 'Show more donors', keeping the search", async () => {
    arrangeViewer();
    lib.listDonors.mockResolvedValue({ kind: "ok", donors: [row("d1", "A")], nextCursor: "next-1" });
    render(await GivingDonorsPage(props({ q: "ab" })));
    expect(screen.getByRole("link", { name: "Show more donors" }).getAttribute("href")).toBe("/o/alder-creek/admin/giving/donors?q=ab&cursor=next-1");
  });

  it("a database failure is the load-error state, not an empty list", async () => {
    arrangeViewer();
    lib.listDonors.mockRejectedValue(new Error("reset"));
    render(await GivingDonorsPage(props()));
    expect(screen.getByText(/we can.t load giving right now/i)).toBeTruthy();
    expect(screen.queryByText("No donors yet")).toBeNull();
  });

  it("rethrows an OrgAccessError", async () => {
    arrangeViewer();
    lib.listWaitingLinkSuggestions.mockRejectedValue(new OrgAccessError("gone"));
    await expect(GivingDonorsPage(props())).rejects.toBeInstanceOf(OrgAccessError);
  });
});

describe("the reduced variant (giving.record without giving.view, S4)", () => {
  function arrangeRecorder() {
    gate.mockResolvedValue(recorder);
    lib.listWaitingLinkSuggestions.mockResolvedValue({ kind: "ok", suggestions: [] });
  }

  it("never lists all donors and never reads the duplicates panel; with no query it asks them to search", async () => {
    arrangeRecorder();
    render(await GivingDonorsPage(props()));
    expect(lib.listDonors).not.toHaveBeenCalled();
    expect(lib.listPossibleDuplicates).not.toHaveBeenCalled();
    expect(lib.searchDonors).not.toHaveBeenCalled();
    expect(screen.getByText(/Type at least two letters/)).toBeTruthy();
    expect(screen.getByTestId("donor-form")).toBeTruthy(); // a recorder may add a donor
  });

  it("a search shows NAMES ONLY - no email, no location, no linked member", async () => {
    arrangeRecorder();
    lib.searchDonors.mockResolvedValue({ kind: "ok", donors: [{ id: "d1", displayName: "Rosalind Reduced", kind: "identified", hasEmail: true }] });
    const { container } = render(await GivingDonorsPage(props({ q: "ros" })));
    expect(lib.searchDonors).toHaveBeenCalledWith("p1", "o1", "ros");
    expect(screen.getByText("Rosalind Reduced")).toBeTruthy();
    expect(container.textContent).not.toMatch(/@|Dover|Linked to/);
  });

  it("a one-letter search does not query; no results is an honest empty state", async () => {
    arrangeRecorder();
    render(await GivingDonorsPage(props({ q: "r" })));
    expect(lib.searchDonors).not.toHaveBeenCalled();
    cleanup();
    lib.searchDonors.mockResolvedValue({ kind: "ok", donors: [] });
    render(await GivingDonorsPage(props({ q: "zz" })));
    expect(screen.getByText("No donors match that search")).toBeTruthy();
  });

  it("the suggestions panel is available to a recorder (it is the S4 link-confirm entry point)", async () => {
    arrangeRecorder();
    lib.listWaitingLinkSuggestions.mockResolvedValue({ kind: "ok", suggestions: [{ donorId: "d9", donorName: "W. Ashgrove", membershipId: "m1", personName: "Winifred Ashgrove" }] });
    render(await GivingDonorsPage(props()));
    expect(screen.getByText("Looks like Winifred Ashgrove")).toBeTruthy();
  });
});
