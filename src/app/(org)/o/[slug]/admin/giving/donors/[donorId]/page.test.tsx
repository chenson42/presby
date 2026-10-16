// @vitest-environment jsdom
/**
 * `/o/<slug>/admin/giving/donors/[donorId]` page (docs/work-log/
 * 2026-10-15-online-giving.md, Batch 2 and S4): the full page for giving.view
 * (with edit and merge for giving.manage), the REDUCED page for giving.record
 * alone (name, kind, link and proposal - never contact detail), redirect for a
 * merged donor, a real 404 otherwise.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const gate = vi.fn();
vi.mock("../../giving-page-gate", () => ({ gateGivingPage: (...a: unknown[]) => gate(...a) }));
const lib = vi.hoisted(() => ({ getDonor: vi.fn(), getDonorReduced: vi.fn() }));
vi.mock("@/lib/giving/donors", () => lib);
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({ OrgAccessError }));
const notFound = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ notFound: () => notFound(), redirect: (u: string) => redirect(u) }));
vi.mock("../donor-form", () => ({ DonorForm: () => <div data-testid="donor-form" /> }));
vi.mock("../link-panel", () => ({ LinkPanel: ({ canLink, proposals }: { canLink: boolean; proposals: unknown[] }) => <div data-testid="link-panel">{String(canLink)}:{proposals.length}</div> }));
vi.mock("../merge-dialog", () => ({ MergeDonorDialog: ({ label }: { label: string }) => <button type="button">{label}</button> }));

import GivingDonorPage from "./page";

const DONOR = "11111111-1111-4111-8111-111111111111";
const org = { personId: "p1", organizationId: "o1", name: "Alder Creek Presbyterian Church", organizationType: "congregation", slug: "alder-creek" };
const mk = (has: { view: boolean; record: boolean; manage: boolean }) => ({ ok: true, userId: "u1", org, has });
const props = (donorId = DONOR) => ({ params: Promise.resolve({ slug: "alder-creek", donorId }) });
const full = (over: Record<string, unknown> = {}) => ({
  id: DONOR, displayName: "Rosalind Reduced", kind: "identified", email: "rosalind@example.invalid", addressLine1: "1 Mill Road",
  addressLine2: null, city: "Dover", region: "DE", postalCode: "19901", country: "US", link: null, proposals: [{ membershipId: "m1", personName: "Rosalind R." }],
  mergedFromCount: 0, possibleDuplicates: [], hasProviderIdentity: false, ...over,
});

afterEach(() => {
  cleanup();
  gate.mockReset();
  lib.getDonor.mockReset();
  lib.getDonorReduced.mockReset();
  notFound.mockClear();
  redirect.mockClear();
});

describe("the full page (giving.view)", () => {
  it("shows contact detail, the link panel (read-only without record) and a way to the donor's gifts", async () => {
    gate.mockResolvedValue(mk({ view: true, record: false, manage: false }));
    lib.getDonor.mockResolvedValue({ kind: "ok", donor: full() });
    render(await GivingDonorPage(props()));
    expect(screen.getByText("rosalind@example.invalid")).toBeTruthy();
    expect(screen.getByText("1 Mill Road")).toBeTruthy();
    expect(screen.getByText("Dover DE 19901")).toBeTruthy();
    expect(screen.getByTestId("link-panel").textContent).toBe("false:1");
    expect(screen.getByRole("link", { name: /see this donor.s gifts/i }).getAttribute("href")).toBe(`/o/alder-creek/admin/giving/gifts?donor=${DONOR}`);
    expect(screen.queryByTestId("donor-form")).toBeNull();
    expect(screen.queryByRole("button", { name: /merge/i })).toBeNull();
  });

  it("giving.manage adds the edit form and a merge control; record adds link buttons", async () => {
    gate.mockResolvedValue(mk({ view: true, record: true, manage: true }));
    lib.getDonor.mockResolvedValue({ kind: "ok", donor: full({ possibleDuplicates: [{ id: "d2", displayName: "R. Reduced", reason: "same_name" }] }) });
    render(await GivingDonorPage(props()));
    expect(screen.getByTestId("donor-form")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Merge into another donor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Merge into R. Reduced" })).toBeTruthy();
    expect(screen.getByTestId("link-panel").textContent).toBe("true:1");
  });

  it("a donor with no email or address says what that means for statements", async () => {
    gate.mockResolvedValue(mk({ view: true, record: false, manage: false }));
    lib.getDonor.mockResolvedValue({ kind: "ok", donor: full({ email: null, addressLine1: null, city: null, region: null, postalCode: null }) });
    render(await GivingDonorPage(props()));
    expect(screen.getByText(/listed as an exception when statements are issued/)).toBeTruthy();
  });

  it("the plate-offering donor has no contact, no link panel, no edit and no merge", async () => {
    gate.mockResolvedValue(mk({ view: true, record: true, manage: true }));
    lib.getDonor.mockResolvedValue({ kind: "ok", donor: full({ kind: "unidentified", email: null, addressLine1: null, city: null, region: null, postalCode: null, proposals: [] }) });
    render(await GivingDonorPage(props()));
    expect(screen.getByText(/never receives a statement/)).toBeTruthy();
    expect(screen.queryByTestId("link-panel")).toBeNull();
    expect(screen.queryByTestId("donor-form")).toBeNull();
    expect(screen.queryByRole("button", { name: /merge/i })).toBeNull();
  });

  it("a merged donor redirects to its survivor; an unknown or malformed id is a real 404", async () => {
    gate.mockResolvedValue(mk({ view: true, record: false, manage: false }));
    lib.getDonor.mockResolvedValue({ kind: "merged", survivorId: "s1" });
    await expect(GivingDonorPage(props())).rejects.toThrow("REDIRECT:/o/alder-creek/admin/giving/donors/s1");
    lib.getDonor.mockResolvedValue({ kind: "not_found" });
    await expect(GivingDonorPage(props())).rejects.toThrow("NOT_FOUND");
    lib.getDonor.mockClear();
    await expect(GivingDonorPage(props("nope"))).rejects.toThrow("NOT_FOUND");
    expect(lib.getDonor).not.toHaveBeenCalled();
  });

  it("a read failure is the load-error state; an OrgAccessError is rethrown", async () => {
    gate.mockResolvedValue(mk({ view: true, record: false, manage: false }));
    lib.getDonor.mockRejectedValue(new Error("reset"));
    render(await GivingDonorPage(props()));
    expect(screen.getByText(/we can.t load giving right now/i)).toBeTruthy();
    lib.getDonor.mockRejectedValue(new OrgAccessError("gone"));
    await expect(GivingDonorPage(props())).rejects.toBeInstanceOf(OrgAccessError);
  });
});

describe("the reduced page (giving.record without giving.view, S4)", () => {
  it("shows the name and the link panel - and NOT the full read, contact detail, edit or merge", async () => {
    gate.mockResolvedValue(mk({ view: false, record: true, manage: false }));
    lib.getDonorReduced.mockResolvedValue({ kind: "ok", donor: { id: DONOR, displayName: "Rosalind Reduced", kind: "identified", link: null, proposals: [{ membershipId: "m1", personName: "Rosalind R." }] } });
    const { container } = render(await GivingDonorPage(props()));
    expect(lib.getDonor).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Rosalind Reduced" })).toBeTruthy();
    expect(screen.getByTestId("link-panel").textContent).toBe("true:1");
    expect(container.textContent).not.toMatch(/@|Mill Road|Dover/);
    expect(screen.queryByRole("link", { name: /gifts/i })).toBeNull();
    expect(screen.queryByTestId("donor-form")).toBeNull();
    expect(screen.queryByRole("button", { name: /merge/i })).toBeNull();
  });

  it("the plate donor says it has no one to link; an unknown donor is a 404", async () => {
    gate.mockResolvedValue(mk({ view: false, record: true, manage: false }));
    lib.getDonorReduced.mockResolvedValue({ kind: "ok", donor: { id: DONOR, displayName: "Unidentified (plate offering)", kind: "unidentified", link: null, proposals: [] } });
    render(await GivingDonorPage(props()));
    expect(screen.getByText(/no donor to link to a member/)).toBeTruthy();
    expect(screen.queryByTestId("link-panel")).toBeNull();
    lib.getDonorReduced.mockResolvedValue({ kind: "not_found" });
    await expect(GivingDonorPage(props())).rejects.toThrow("NOT_FOUND");
  });
});
