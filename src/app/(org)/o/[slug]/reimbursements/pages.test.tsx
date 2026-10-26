// @vitest-environment jsdom
/**
 * The member pages (Phase 3 "Component / Page Plan", EC16, EC24, EC25, P3-3):
 * every gate state renders honestly, a request the viewer may not see is the one
 * neutral 404, a treasury-only viewer is sent to the treasurer page, and no page
 * calls a write function (opening a request changes nothing).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const gate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/reimbursement/gate", () => ({ gateReimbursementPage: (...a: unknown[]) => gate(...a) }));
const reads = vi.hoisted(() => ({
  getFormOptions: vi.fn(),
  getOrgToday: vi.fn(),
  listMyRequests: vi.fn(),
  listWaitingForMe: vi.fn(),
  getRequestDetail: vi.fn(),
}));
vi.mock("@/lib/reimbursement/reads", () => reads);
const writes = vi.hoisted(() => ({
  saveRequest: vi.fn(),
  submitRequest: vi.fn(),
  withdrawRequest: vi.fn(),
  approveRequest: vi.fn(),
  returnRequest: vi.fn(),
}));
vi.mock("@/lib/reimbursement/requests", () => writes);
vi.mock("@/lib/reimbursement/decisions", () => writes);
vi.mock("@/lib/authz", () => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("./actions", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("../org-states", () => ({
  OrgAccessDenied: ({ name }: { name: string }) => <p>denied {name}</p>,
  OrgAccessEnded: ({ name }: { name: string }) => <p>ended {name}</p>,
}));

import { COPY } from "@/lib/reimbursement/copy";
import ListPage from "./page";
import NewPage from "./new/page";
import DetailPage from "./[id]/page";
import EditPage from "./[id]/edit/page";

const ID = "44444444-4444-4444-8444-444444444444";
const identity = {
  userId: "u", personId: "person-1", organizationId: "org-1", organizationName: "Alder Creek", organizationType: "congregation",
  slug: "alder", email: null, has: { requestForOthers: false, view: false, pay: false, manage: false },
};
const okGate = (has: Partial<typeof identity.has> = {}) => ({ ok: true, identity: { ...identity, has: { ...identity.has, ...has } } });
const params = Promise.resolve({ slug: "alder" });
const idParams = Promise.resolve({ slug: "alder", id: ID });
const options = (over = {}) => ({ mayFile: true, groups: [{ id: "g", name: "Property" }], categories: [], canRequestForOthers: false, ...over });
const call = async (fn: () => Promise<unknown>) => {
  try {
    return { node: await fn() as React.ReactNode, thrown: null as string | null };
  } catch (e) {
    return { node: null, thrown: (e as Error).message };
  }
};

function detail(over: Record<string, unknown> = {}, viewer: Record<string, unknown> = {}) {
  return {
    level: "member", id: ID, status: "submitted", kind: "reimburse", origin: "app", revision: 3, amountCents: 4250, currency: "usd",
    expenseDate: "2026-10-20", purpose: "Folding tables", preApprovedByName: null, noReceiptClaimed: true,
    createdAt: "2026-10-20T10:00:00Z", firstSubmittedAt: "2026-10-20T10:00:00Z", submittedAt: "2026-10-20T10:00:00Z", updatedAt: "2026-10-20T10:00:00Z",
    group: { id: "g", name: "Property Committee" }, category: null, payee: { kind: "person", name: "Tamsin Brightwater", personId: "person-1" },
    enteredOnBehalf: false, receipts: [], receiptWaived: false, approvedOn: null, decidedOn: null, latestReason: null, route: "seat", paidOn: null,
    duplicateReceipt: null, history: [{ kind: "submitted", on: "2026-10-20", at: "2026-10-20T10:00:00Z" }],
    viewer: { relation: "creator", canEdit: false, canWithdraw: true, canDecide: false, ...viewer },
    ...over,
  };
}

beforeEach(() => {
  gate.mockReset();
  for (const fn of [...Object.values(reads), ...Object.values(writes)]) fn.mockReset();
});
afterEach(cleanup);

describe("gate states render honestly on every page", () => {
  it.each([
    [{ kind: "toggle_off", name: "Alder Creek", canManageFeatures: false }, COPY.page.toggleOff("Alder Creek"), COPY.page.toggleOffAsk],
    [{ kind: "toggle_off", name: "Alder Creek", canManageFeatures: true }, COPY.page.toggleOff("Alder Creek"), "Features"],
    [{ kind: "not_applicable", name: "Alder Creek" }, COPY.page.notApplicable, null],
    [{ kind: "load_error" }, COPY.page.loadError, null],
  ])("%j", async (state, text, extra) => {
    for (const page of [() => ListPage({ params }), () => NewPage({ params }), () => DetailPage({ params: idParams }), () => EditPage({ params: idParams })]) {
      gate.mockResolvedValue({ ok: false, state });
      const { node } = await call(page);
      render(<>{node}</>);
      expect(screen.getByText(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).textContent).toContain(text);
      if (extra) expect(document.body.textContent).toContain(extra);
      cleanup();
    }
  });

  it("the Features link appears only for someone who can use it", async () => {
    gate.mockResolvedValue({ ok: false, state: { kind: "toggle_off", name: "A", canManageFeatures: true } });
    render(<>{(await call(() => ListPage({ params }))).node}</>);
    expect(screen.getByRole("link", { name: "Features" }).getAttribute("href")).toBe("/o/alder/admin/features");
    cleanup();
    gate.mockResolvedValue({ ok: false, state: { kind: "toggle_off", name: "A", canManageFeatures: false } });
    render(<>{(await call(() => ListPage({ params }))).node}</>);
    expect(screen.queryByRole("link", { name: "Features" })).toBeNull();
  });

  it("the member gate is asked with the page's own path, so a signed-out visitor keeps the deep link", async () => {
    gate.mockResolvedValue({ ok: false, state: { kind: "load_error" } });
    await call(() => DetailPage({ params: idParams }));
    expect(gate).toHaveBeenCalledWith({ slug: "alder", path: `/o/alder/reimbursements/${ID}` });
    await call(() => EditPage({ params: idParams }));
    expect(gate).toHaveBeenLastCalledWith({ slug: "alder", path: `/o/alder/reimbursements/${ID}/edit` });
  });
});

describe("the list page", () => {
  const arrange = (over: Record<string, unknown> = {}) => {
    gate.mockResolvedValue(okGate());
    reads.getFormOptions.mockResolvedValue(options());
    reads.listMyRequests.mockResolvedValue({ kind: "ok", items: [] });
    reads.listWaitingForMe.mockResolvedValue({ kind: "ok", items: [] });
    for (const [k, v] of Object.entries(over)) (reads as Record<string, ReturnType<typeof vi.fn>>)[k]!.mockResolvedValue(v);
  };

  it("an empty member sees the lead, New request and the empty sentence, and no waiting section", async () => {
    arrange();
    render(<>{(await call(() => ListPage({ params }))).node}</>);
    expect(screen.getByText(COPY.page.lead("Alder Creek"))).toBeTruthy();
    expect(screen.getByRole("link", { name: COPY.page.newRequest }).getAttribute("href")).toBe("/o/alder/reimbursements/new");
    expect(screen.getByText(COPY.page.noRequestsYet)).toBeTruthy();
    expect(screen.queryByText(/Waiting for your approval/)).toBeNull();
    expect(screen.queryByRole("link", { name: COPY.page.treasurerView })).toBeNull();
  });

  it("a member who may not file sees the sentence and the list, not New request", async () => {
    arrange({ getFormOptions: options({ mayFile: false, groups: [] }) });
    render(<>{(await call(() => ListPage({ params }))).node}</>);
    expect(screen.getByTestId("cannot-file").textContent).toBe(COPY.page.cannotFile("Alder Creek"));
    expect(screen.queryByRole("link", { name: COPY.page.newRequest })).toBeNull();
  });

  it("waiting requests get the counted heading; a treasury key holder gets the Treasurer view link", async () => {
    arrange({
      listWaitingForMe: { kind: "ok", items: [{ id: ID, kind: "reimburse", payeeLabel: "Tamsin", amountCents: 4250, expenseDate: "2026-10-20", groupName: "Property", purposeExcerpt: "Tables", revision: 3, enteredOnBehalf: false, submittedAt: "2026-10-20T10:00:00Z" }] },
    });
    gate.mockResolvedValue(okGate({ view: true }));
    render(<>{(await call(() => ListPage({ params }))).node}</>);
    expect(screen.getByRole("heading", { name: "Waiting for your approval (1)" })).toBeTruthy();
    expect(screen.getByTestId("waiting-row").getAttribute("href")).toBe(`/o/alder/reimbursements/${ID}`);
    expect(screen.getByRole("link", { name: COPY.page.treasurerView }).getAttribute("href")).toBe("/o/alder/admin/reimbursements");
  });

  it("a read that throws is a load error, never an empty list", async () => {
    arrange();
    reads.listMyRequests.mockRejectedValue(new Error("db"));
    render(<>{(await call(() => ListPage({ params }))).node}</>);
    expect(screen.getByText(COPY.page.loadError)).toBeTruthy();
    expect(screen.queryByText(COPY.page.noRequestsYet)).toBeNull();
  });

  it("writes nothing", async () => {
    arrange();
    await call(() => ListPage({ params }));
    for (const fn of Object.values(writes)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("the new page", () => {
  it("a member who may not file gets the sentence, not a form", async () => {
    gate.mockResolvedValue(okGate());
    reads.getFormOptions.mockResolvedValue(options({ mayFile: false }));
    reads.getOrgToday.mockResolvedValue("2026-10-26");
    render(<>{(await call(() => NewPage({ params }))).node}</>);
    expect(screen.getByTestId("cannot-file")).toBeTruthy();
    expect(screen.queryByTestId("request-form")).toBeNull();
  });
  it("a member who may gets the form", async () => {
    gate.mockResolvedValue(okGate());
    reads.getFormOptions.mockResolvedValue(options());
    reads.getOrgToday.mockResolvedValue("2026-10-26");
    render(<>{(await call(() => NewPage({ params }))).node}</>);
    expect(screen.getByTestId("request-form")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(COPY.form.createHeading);
  });
});

describe("the request page", () => {
  const arrange = (found: unknown) => {
    gate.mockResolvedValue(okGate());
    reads.getRequestDetail.mockResolvedValue(found);
  };

  it("a missing request, a forbidden one and a refused identity are the same notFound()", async () => {
    for (const found of [{ kind: "not_found" }, { kind: "denied" }]) {
      arrange(found);
      expect((await call(() => DetailPage({ params: idParams }))).thrown).toBe("NOT_FOUND");
    }
    expect(reads.getRequestDetail).toHaveBeenCalledWith(expect.anything(), ID, "member");
  });

  it("a viewer who is only a treasury key holder is sent to the treasurer page", async () => {
    arrange({ kind: "ok", detail: detail({}, { relation: "treasury", canWithdraw: false }) });
    expect((await call(() => DetailPage({ params: idParams }))).thrown).toBe(`REDIRECT:/o/alder/admin/reimbursements/${ID}`);
  });

  it("opening it as an approver changes nothing: no write function is called", async () => {
    arrange({ kind: "ok", detail: detail({}, { relation: "seat", canWithdraw: false, canDecide: true }) });
    render(<>{(await call(() => DetailPage({ params: idParams }))).node}</>);
    expect(screen.getByTestId("approve-open")).toBeTruthy();
    for (const fn of Object.values(writes)) expect(fn).not.toHaveBeenCalled();
  });

  it("the requester sees 'to you' wording and their own buttons; the approver sees neither", async () => {
    arrange({ kind: "ok", detail: detail({ status: "returned", latestReason: "Add the date", route: null }, { canEdit: true }) });
    render(<>{(await call(() => DetailPage({ params: idParams }))).node}</>);
    expect(screen.getByTestId("request-banner").textContent).toBe("Sent back to you. Reason: Add the date");
    expect(screen.getByTestId("status-badge").textContent).toBe("Sent back to you");
    expect(screen.getByRole("link", { name: COPY.detail.buttons.editAndSendAgain }).getAttribute("href")).toBe(`/o/alder/reimbursements/${ID}/edit`);
    expect(screen.getByTestId("withdraw-open")).toBeTruthy();
    cleanup();
    arrange({ kind: "ok", detail: detail({ status: "returned", latestReason: "Add the date", route: null }, { relation: "seat", canWithdraw: false, canDecide: false }) });
    render(<>{(await call(() => DetailPage({ params: idParams }))).node}</>);
    expect(screen.getByTestId("request-banner").textContent).toBe("Sent back. Reason: Add the date");
    expect(screen.queryByTestId("withdraw-open")).toBeNull();
  });

  it("offers 'Print the form' to every viewer, as a plain link to the print route (never a prefetching Link)", async () => {
    for (const viewer of [
      { relation: "creator" as const, canEdit: true },
      { relation: "beneficiary" as const, canWithdraw: false },
      { relation: "seat" as const, canWithdraw: false, canDecide: true },
    ]) {
      arrange({ kind: "ok", detail: detail({}, viewer) });
      render(<>{(await call(() => DetailPage({ params: idParams }))).node}</>);
      const print = screen.getByTestId("request-print");
      expect(print.textContent).toBe(COPY.detail.buttons.print);
      expect(print.tagName).toBe("A");
      expect(print.getAttribute("href")).toBe(`/o/alder/reimbursements/${ID}/print`);
      expect(print.getAttribute("data-prefetch")).toBeNull();
      cleanup();
    }
  });

  it.each([
    [{ status: "draft", route: null }, "This is a draft. Only you can see it."],
    [{ status: "submitted", route: "treasurer" }, "Waiting for the treasurer to approve it."],
    [{ status: "submitted", route: "nobody" }, COPY.detail.banner.submitted.nobody],
    [{ status: "not_approved", latestReason: "Over budget", route: null }, "Not approved. Reason: Over budget"],
    [{ status: "withdrawn", route: null }, "This request was withdrawn."],
    [{ status: "voided", route: null }, COPY.detail.banner.voided],
  ])("banner for %j", async (over, text) => {
    arrange({ kind: "ok", detail: detail(over) });
    render(<>{(await call(() => DetailPage({ params: idParams }))).node}</>);
    expect(screen.getByTestId("request-banner").textContent).toBe(text);
  });

  it("approved and paid banners carry their date", async () => {
    arrange({ kind: "ok", detail: detail({ status: "approved", approvedOn: "2026-10-21", route: null }) });
    render(<>{(await call(() => DetailPage({ params: idParams }))).node}</>);
    expect(screen.getByTestId("request-banner").textContent).toMatch(/^Approved on .+\. Waiting for payment\.$/);
    cleanup();
    arrange({ kind: "ok", detail: detail({ status: "paid", paidOn: "2026-10-22", route: null }) });
    render(<>{(await call(() => DetailPage({ params: idParams }))).node}</>);
    expect(screen.getByTestId("request-banner").textContent).toMatch(/^Paid on .+\.$/);
  });

  it("the duplicate-receipt and on-behalf flags follow the audience (never the requester)", async () => {
    arrange({ kind: "ok", detail: detail({ duplicateReceipt: true, enteredOnBehalf: true }, { relation: "seat", canWithdraw: false }) });
    render(<>{(await call(() => DetailPage({ params: idParams }))).node}</>);
    expect(screen.getByTestId("flag-duplicate-receipt").textContent).toBe(COPY.detail.duplicateReceipt);
    expect(screen.getByTestId("flag-entered-on-behalf").textContent).toBe(COPY.detail.enteredOnBehalf);
    expect(screen.getByText(COPY.detail.noReceiptClaimed)).toBeTruthy();
    cleanup();
    arrange({ kind: "ok", detail: detail({ duplicateReceipt: null, enteredOnBehalf: true }, { relation: "beneficiary", canWithdraw: true }) });
    render(<>{(await call(() => DetailPage({ params: idParams }))).node}</>);
    expect(screen.queryByTestId("flag-duplicate-receipt")).toBeNull();
    expect(screen.getByTestId("flag-entered-for-you").textContent).toBe(COPY.detail.enteredForYou);
    expect(screen.queryByText(COPY.detail.noReceiptClaimed)).toBeNull();
  });

  it("history uses Copy's labels and shows no name", async () => {
    arrange({ kind: "ok", detail: detail({ history: [{ kind: "created", on: "2026-10-19", at: "a" }, { kind: "resubmitted", on: "2026-10-20", at: "b" }] }) });
    render(<>{(await call(() => DetailPage({ params: idParams }))).node}</>);
    const history = screen.getByTestId("request-history").textContent!;
    expect(history).toContain("Started");
    expect(history).toContain("Sent again");
  });
});

describe("the edit page", () => {
  const arrange = (d: unknown) => {
    gate.mockResolvedValue(okGate());
    reads.getRequestDetail.mockResolvedValue({ kind: "ok", detail: d });
    reads.getFormOptions.mockResolvedValue(options());
    reads.getOrgToday.mockResolvedValue("2026-10-26");
  };
  it("only the creator: anyone else is the neutral 404", async () => {
    arrange(detail({}, { relation: "seat", canEdit: false }));
    expect((await call(() => EditPage({ params: idParams }))).thrown).toBe("NOT_FOUND");
  });
  it("a creator whose request can no longer be edited is sent to its page", async () => {
    arrange(detail({}, { canEdit: false }));
    expect((await call(() => EditPage({ params: idParams }))).thrown).toBe(`REDIRECT:/o/alder/reimbursements/${ID}`);
  });
  it("a creator of an editable request gets the prefilled form", async () => {
    arrange(detail({ status: "returned" }, { canEdit: true }));
    render(<>{(await call(() => EditPage({ params: idParams }))).node}</>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(COPY.form.editHeading);
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("$42.50");
    expect(screen.getByTestId("request-form-frozen").textContent).toContain("Property Committee");
  });
});
