/**
 * Orchestration tests for the donor server actions (docs/work-log/
 * 2026-10-15-online-giving.md, Batch 2): the right key per action (record for
 * create and the three link actions; manage for contact edits and merge),
 * validation first, plain-language mapping of every library result, and audit
 * events that carry ids and field NAMES - never a name, an email or an address.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/action-gate", async () => {
  const { zodFieldErrors } = await import("@/lib/giving/field-errors");
  return {
    gateGivingAction: (...a: unknown[]) => gate(...a),
    invalidInput: (e: import("zod").ZodError) => ({ ok: false, error: "Check the highlighted fields and try again.", fieldErrors: zodFieldErrors(e) }),
  };
});
const recordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    GIVING_DONOR_CREATED: "tenant.giving_donor.created",
    GIVING_DONOR_CONTACT_CHANGED: "tenant.giving_donor.contact_changed",
    GIVING_DONOR_MERGED: "tenant.giving_donor.merged",
    GIVING_DONOR_LINK_CONFIRMED: "tenant.giving_donor.link_confirmed",
    GIVING_DONOR_LINK_REMOVED: "tenant.giving_donor.link_removed",
    GIVING_DONOR_LINK_DISMISSED: "tenant.giving_donor.link_dismissed",
  },
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));
const lib = vi.hoisted(() => ({
  createDonor: vi.fn(), updateDonorContact: vi.fn(), mergeDonors: vi.fn(),
  confirmLink: vi.fn(), dismissLink: vi.fn(), removeLink: vi.fn(),
}));
vi.mock("@/lib/giving/donors", () => lib);
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import {
  confirmLinkAction, createDonorAction, dismissLinkAction, mergeDonorsAction,
  removeLinkAction, updateDonorContactAction,
} from "./actions";

const IDENTITY = { ok: true, userId: "user-1", personId: "person-1", organizationId: "org-1", has: { view: true, record: true, manage: true } };
const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";
const M1 = "33333333-3333-4333-8333-333333333333";

afterEach(() => {
  gate.mockReset();
  recordAudit.mockClear();
  revalidatePath.mockReset();
  for (const fn of Object.values(lib)) fn.mockReset();
});

describe("which key each action asks for", () => {
  it.each([
    ["createDonorAction", () => createDonorAction("s", { displayName: "A" }), ["record"]],
    ["confirmLinkAction", () => confirmLinkAction("s", { donorId: D1, membershipId: M1 }), ["record"]],
    ["dismissLinkAction", () => dismissLinkAction("s", { donorId: D1, membershipId: M1 }), ["record"]],
    ["removeLinkAction", () => removeLinkAction("s", { donorId: D1 }), ["record"]],
    ["updateDonorContactAction", () => updateDonorContactAction("s", { donorId: D1, displayName: "A" }), ["manage"]],
    ["mergeDonorsAction", () => mergeDonorsAction("s", { sourceId: D1, targetId: D2 }), ["manage"]],
  ])("%s", async (_name, call, keys) => {
    gate.mockResolvedValue({ ok: false, error: "nope" });
    expect(await call()).toEqual({ ok: false, error: "nope" });
    expect(gate).toHaveBeenCalledWith("s", keys);
    for (const fn of Object.values(lib)) expect(fn).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("createDonorAction", () => {
  it("validates first: a bad email is an inline error", async () => {
    gate.mockResolvedValue(IDENTITY);
    expect(await createDonorAction("s", { displayName: "A", email: "nope" })).toMatchObject({ ok: false, fieldErrors: { email: expect.any(String) } });
    expect(lib.createDonor).not.toHaveBeenCalled();
  });

  it("a duplicate is ok-with-status and writes nothing; acknowledging passes the flag through", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.createDonor.mockResolvedValue({ kind: "duplicate_warning", donors: [{ id: D2, displayName: "Josephine" }] });
    expect(await createDonorAction("s", { displayName: "Josephine" })).toEqual({ ok: true, data: { status: "duplicate_donor", donors: [{ id: D2, displayName: "Josephine" }] } });
    expect(recordAudit).not.toHaveBeenCalled();
    lib.createDonor.mockResolvedValue({ kind: "ok", donorId: D1 });
    await createDonorAction("s", { displayName: "Josephine" }, { acknowledgeDuplicate: true });
    expect(lib.createDonor).toHaveBeenLastCalledWith("person-1", "org-1", "user-1", expect.anything(), { acknowledgeDuplicate: true });
  });

  it("audits the creation by id only (no name, no email)", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.createDonor.mockResolvedValue({ kind: "ok", donorId: D1 });
    expect(await createDonorAction("s", { displayName: "Ottoline Vance", email: "o@example.invalid" })).toEqual({ ok: true, data: { status: "created", donorId: D1 } });
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.giving_donor.created", resourceType: "giving_donor", resourceId: D1,
      metadata: { organizationId: "org-1", donorId: D1, via: "donor_form" },
    });
    expect(JSON.stringify(recordAudit.mock.calls)).not.toMatch(/Ottoline|example\.invalid/);
  });
});

describe("updateDonorContactAction", () => {
  it("audits which FIELDS changed, never their values; no change, no audit", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.updateDonorContact.mockResolvedValue({ kind: "ok", changedFields: ["email", "city"] });
    expect(await updateDonorContactAction("s", { donorId: D1, displayName: "Z", email: "new@example.invalid", city: "Dover" })).toEqual({ ok: true });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "tenant.giving_donor.contact_changed",
      metadata: { organizationId: "org-1", donorId: D1, fields: ["email", "city"] },
    }));
    expect(JSON.stringify(recordAudit.mock.calls)).not.toMatch(/new@example|Dover/);
    recordAudit.mockClear();
    lib.updateDonorContact.mockResolvedValue({ kind: "ok", changedFields: [] });
    await updateDonorContactAction("s", { donorId: D1, displayName: "Z" });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("maps not_found and not_editable", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.updateDonorContact.mockResolvedValue({ kind: "not_found" });
    expect(await updateDonorContactAction("s", { donorId: D1, displayName: "Z" })).toEqual({ ok: false, error: "That donor no longer exists." });
    lib.updateDonorContact.mockResolvedValue({ kind: "not_editable" });
    expect(await updateDonorContactAction("s", { donorId: D1, displayName: "Z" })).toMatchObject({ ok: false, error: expect.stringMatching(/can't be edited/) });
  });
});

describe("mergeDonorsAction", () => {
  it("audits source, target and counts - and revalidates both donors", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.mergeDonors.mockResolvedValue({ kind: "ok", repointedCount: 2, inheritedLink: true });
    expect(await mergeDonorsAction("alder-creek", { sourceId: D1, targetId: D2 })).toEqual({ ok: true, data: { targetId: D2 } });
    expect(lib.mergeDonors).toHaveBeenCalledWith("person-1", "org-1", "user-1", D1, D2);
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.giving_donor.merged", resourceType: "giving_donor", resourceId: D1,
      metadata: { organizationId: "org-1", sourceId: D1, targetId: D2, repointedCount: 2, inheritedLink: true },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/o/alder-creek/admin/giving/donors/${D1}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/o/alder-creek/admin/giving/donors/${D2}`);
  });

  it.each([
    [{ kind: "same_donor" }, /different donor/],
    [{ kind: "not_found" }, /no longer exists/],
    [{ kind: "invalid_target" }, /can't be merged/],
    [{ kind: "link_conflict" }, /different members/],
    [{ kind: "forbidden" }, /permission/],
  ])("maps %j with no audit", async (libResult, pattern) => {
    gate.mockResolvedValue(IDENTITY);
    lib.mergeDonors.mockResolvedValue(libResult);
    const result = await mergeDonorsAction("s", { sourceId: D1, targetId: D2 });
    expect((result as { error: string }).error).toMatch(pattern);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("rejects non-uuid ids before the library runs", async () => {
    gate.mockResolvedValue(IDENTITY);
    expect(await mergeDonorsAction("s", { sourceId: "x", targetId: D2 })).toMatchObject({ ok: false, fieldErrors: expect.any(Object) });
    expect(lib.mergeDonors).not.toHaveBeenCalled();
  });
});

describe("the link actions", () => {
  it("confirm: audits the membership id (not the member's name) and returns the name for the toast", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.confirmLink.mockResolvedValue({ kind: "ok", personName: "Constance Hale" });
    expect(await confirmLinkAction("s", { donorId: D1, membershipId: M1 })).toEqual({ ok: true, data: { personName: "Constance Hale" } });
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.giving_donor.link_confirmed", resourceType: "giving_donor", resourceId: D1,
      metadata: { organizationId: "org-1", donorId: D1, membershipId: M1 },
    });
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain("Constance");
  });

  it.each([
    [{ kind: "already_linked" }, /already linked/],
    [{ kind: "no_proposal" }, /no longer available/],
    [{ kind: "not_found" }, /no longer exists/],
  ])("confirm maps %j with no audit", async (libResult, pattern) => {
    gate.mockResolvedValue(IDENTITY);
    lib.confirmLink.mockResolvedValue(libResult);
    expect((await confirmLinkAction("s", { donorId: D1, membershipId: M1 }) as { error: string }).error).toMatch(pattern);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("dismiss and remove audit with their own keys", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.dismissLink.mockResolvedValue({ kind: "ok" });
    expect(await dismissLinkAction("s", { donorId: D1, membershipId: M1 })).toEqual({ ok: true });
    lib.removeLink.mockResolvedValue({ kind: "ok", membershipId: M1, personName: "Rene Removed" });
    expect(await removeLinkAction("s", { donorId: D1 })).toEqual({ ok: true });
    expect(recordAudit.mock.calls.map((c) => (c[0] as { action: string }).action)).toEqual([
      "tenant.giving_donor.link_dismissed",
      "tenant.giving_donor.link_removed",
    ]);
    expect(recordAudit).toHaveBeenLastCalledWith(expect.objectContaining({ metadata: { organizationId: "org-1", donorId: D1, membershipId: M1 } }));
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain("Rene");
  });
});
