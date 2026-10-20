// @vitest-environment jsdom
/**
 * `/o/<slug>/admin/giving/gifts/[giftId]` page (docs/work-log/2026-10-15-online-giving.md,
 * Batch 2): giving.view, a real 404 for an unknown or malformed id, provenance,
 * reversals, and a void control only when the viewer can really use it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const gate = vi.fn();
vi.mock("../../giving-page-gate", () => ({ gateGivingPage: (...a: unknown[]) => gate(...a) }));
const getGift = vi.fn();
vi.mock("@/lib/giving/gifts", () => ({ getGift: (...a: unknown[]) => getGift(...a) }));
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({ OrgAccessError }));
const notFound = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));
vi.mock("../void-dialog", () => ({ VoidGiftDialog: () => <button type="button">Void gift</button> }));

import GivingGiftPage from "./page";

const GIFT_ID = "11111111-1111-4111-8111-111111111111";
const org = { personId: "p1", organizationId: "o1", name: "Alder Creek Presbyterian Church", organizationType: "congregation", slug: "alder-creek" };
const viewer = { ok: true, userId: "u1", org, has: { view: true, record: true, manage: true } };
const detail = (over: Record<string, unknown> = {}) => ({
  id: GIFT_ID, occurredOn: "2026-03-14", donorId: "d1", donorName: "Imogen Thackeray", fundId: "f1", fundName: "General Fund",
  source: "offline", method: "check", status: "succeeded", testMode: false, amountCents: 12_550, donorCoveredFeeCents: 0,
  feeCents: null, netCents: null, checkNumber: "1042", reversedCents: 0, voided: false, stockDescription: null,
  stockQuantity: null, memo: "From the Easter envelope", failureCode: null, recordedByName: "Tess Treasurer",
  createdAt: "2026-03-14T15:00:00Z", reversals: [], canVoid: true, ...over,
});
const props = (giftId = GIFT_ID) => ({ params: Promise.resolve({ slug: "alder-creek", giftId }) });

afterEach(() => {
  cleanup();
  gate.mockReset();
  getGift.mockReset();
  notFound.mockClear();
});

describe("GivingGiftPage", () => {
  it("asks the gate for giving.view on this gift's own path", async () => {
    gate.mockResolvedValue(viewer);
    getGift.mockResolvedValue({ kind: "ok", gift: detail() });
    await GivingGiftPage(props());
    expect(gate).toHaveBeenCalledWith({ slug: "alder-creek", path: `/o/alder-creek/admin/giving/gifts/${GIFT_ID}`, anyOf: ["view"], section: "Gifts" });
  });

  it("shows the gift, its provenance and the note", async () => {
    gate.mockResolvedValue(viewer);
    getGift.mockResolvedValue({ kind: "ok", gift: detail() });
    render(await GivingGiftPage(props()));
    expect(screen.getByRole("heading", { level: 1, name: "$125.50 gift" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Imogen Thackeray" }).getAttribute("href")).toBe("/o/alder-creek/admin/giving/donors/d1");
    expect(screen.getByText("Check #1042")).toBeTruthy();
    expect(screen.getByText("From the Easter envelope")).toBeTruthy();
    expect(screen.getByText(/by Tess Treasurer on/)).toBeTruthy();
    expect(getGift).toHaveBeenCalledWith("p1", "o1", "u1", GIFT_ID);
  });

  it("an online gift shows fee and net; a refund appears under 'Refunds and corrections'", async () => {
    gate.mockResolvedValue(viewer);
    getGift.mockResolvedValue({
      kind: "ok",
      gift: detail({
        source: "online", method: "card", checkNumber: null, memo: null, recordedByName: null, canVoid: false,
        donorCoveredFeeCents: 181, feeCents: 320, netCents: 12_230, reversedCents: 4_000,
        reversals: [{ id: "r1", kind: "refund", amountCents: 4_000, reason: null, occurredOn: "2026-03-20", recordedByName: null }],
      }),
    });
    render(await GivingGiftPage(props()));
    expect(screen.getByText("$1.81")).toBeTruthy();
    expect(screen.getByText("$3.20")).toBeTruthy();
    expect(screen.getByText("$122.30")).toBeTruthy();
    expect(screen.getByText(/automatically from Stripe/)).toBeTruthy();
    expect(screen.getByText("Refund")).toBeTruthy();
    expect(screen.getByText("$40.00")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Void gift" })).toBeNull();
  });

  it("a voided gift lists the void with its reason; an untouched gift says nothing has changed it", async () => {
    gate.mockResolvedValue(viewer);
    getGift.mockResolvedValue({
      kind: "ok",
      gift: detail({ voided: true, canVoid: false, reversedCents: 12_550, reversals: [{ id: "r2", kind: "void", amountCents: 12_550, reason: "Keyed twice", occurredOn: "2026-03-15", recordedByName: "Tess Treasurer" }] }),
    });
    render(await GivingGiftPage(props()));
    expect(screen.getAllByText("Voided").length).toBeGreaterThan(0);
    expect(screen.getByText("Reason: Keyed twice")).toBeTruthy();
    cleanup();
    getGift.mockResolvedValue({ kind: "ok", gift: detail() });
    render(await GivingGiftPage(props()));
    expect(screen.getByText(/Nothing has changed this gift/)).toBeTruthy();
  });

  it("the void control appears only when the library says canVoid", async () => {
    gate.mockResolvedValue(viewer);
    getGift.mockResolvedValue({ kind: "ok", gift: detail({ canVoid: true }) });
    render(await GivingGiftPage(props()));
    expect(screen.getByRole("button", { name: "Void gift" })).toBeTruthy();
    cleanup();
    getGift.mockResolvedValue({ kind: "ok", gift: detail({ canVoid: false }) });
    render(await GivingGiftPage(props()));
    expect(screen.queryByRole("button", { name: "Void gift" })).toBeNull();
  });

  it("a malformed id and an unknown/foreign gift are the same real 404 (and a malformed id never reaches the database)", async () => {
    gate.mockResolvedValue(viewer);
    await expect(GivingGiftPage(props("not-a-uuid"))).rejects.toThrow("NOT_FOUND");
    expect(getGift).not.toHaveBeenCalled();
    getGift.mockResolvedValue({ kind: "not_found" });
    await expect(GivingGiftPage(props())).rejects.toThrow("NOT_FOUND");
  });

  it("returns the gate's refusal untouched, and a read failure is the load-error state", async () => {
    gate.mockResolvedValue({ ok: false, node: <p>REFUSED</p> });
    render(await GivingGiftPage(props()));
    expect(screen.getByText("REFUSED")).toBeTruthy();
    expect(getGift).not.toHaveBeenCalled();
    cleanup();
    gate.mockResolvedValue(viewer);
    getGift.mockRejectedValue(new Error("reset"));
    render(await GivingGiftPage(props()));
    expect(screen.getByText(/we can.t load giving right now/i)).toBeTruthy();
  });

  it("rethrows an OrgAccessError", async () => {
    gate.mockResolvedValue(viewer);
    getGift.mockRejectedValue(new OrgAccessError("gone"));
    await expect(GivingGiftPage(props())).rejects.toBeInstanceOf(OrgAccessError);
  });
});
