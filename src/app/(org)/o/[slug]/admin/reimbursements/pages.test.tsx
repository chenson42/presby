// @vitest-environment jsdom
/**
 * The treasurer pages (Phase 3 "Component / Page Plan", Copy C7 to C9, the Batch 4
 * amendment S7 and X5 to X7, EC16, EC24, EC25): every gate state renders honestly,
 * the queue is built from the PARSED query, a page past the last goes to page 1,
 * the empty states are the tab's own, and the request page is the neutral 404 for
 * anything the viewer cannot read. No page calls a write function.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const gate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/reimbursement/gate", () => ({ gateReimbursementPage: (...a: unknown[]) => gate(...a) }));
const reads = vi.hoisted(() => ({
  listTreasurerRequests: vi.fn(),
  listTreasurerGroups: vi.fn(),
  getCounts: vi.fn(),
  getPayHolderCount: vi.fn(),
  getRequestDetail: vi.fn(),
  getOrgToday: vi.fn(),
  getSettings: vi.fn(),
}));
vi.mock("@/lib/reimbursement/reads", () => reads);
const team = vi.hoisted(() => ({ listTreasuryTeam: vi.fn() }));
vi.mock("@/lib/treasury/team", () => team);
vi.mock("@/lib/authz", () => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("./actions", () => ({}));
vi.mock("./team/actions", () => ({
  grantTreasuryRoleAction: { bind: () => vi.fn() },
  revokeTreasuryRoleAction: { bind: () => vi.fn() },
  ensureTreasuryRoleAction: { bind: () => vi.fn() },
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../org-states", () => ({
  OrgAccessDenied: ({ name }: { name: string }) => <p>denied {name}</p>,
  OrgAccessEnded: ({ name }: { name: string }) => <p>ended {name}</p>,
}));

import { COPY } from "@/lib/reimbursement/copy";
import QueuePage from "./page";
import RequestPage from "./[id]/page";
import SettingsPage from "./settings/page";
import TeamPage from "./team/page";

const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";
const ID = "44444444-4444-4444-8444-444444444444";
const identity = {
  userId: "u", personId: "person-1", organizationId: "org-1", organizationName: "Alder Creek", organizationType: "congregation",
  slug: "alder", email: null, has: { requestForOthers: false, view: true, pay: false, manage: false },
};
const okGate = (has: Partial<typeof identity.has> = {}) => ({ ok: true, identity: { ...identity, has: { ...identity.has, ...has } } });
const params = Promise.resolve({ slug: "alder" });
const idParams = Promise.resolve({ slug: "alder", id: ID });
const search = (q: Record<string, string> = {}) => Promise.resolve(q);
const call = async (fn: () => Promise<unknown>) => {
  try {
    return { node: (await fn()) as React.ReactNode, thrown: null as string | null };
  } catch (e) {
    return { node: null, thrown: (e as Error).message };
  }
};

function row(over: Record<string, unknown> = {}) {
  return {
    id: ID, status: "approved", kind: "reimburse", payeeLabel: "Tamsin Brightwater", amountCents: 4250, expenseDate: "2026-10-20",
    groupId: G1, groupName: "Property Committee", categoryName: null, purposeExcerpt: "Folding tables", creatorName: "Tamsin Brightwater",
    approverName: "Pat Quill", enteredOnBehalf: false, approvalPath: "seat", submittedAt: "2026-10-20T10:00:00Z",
    approvedAt: "2026-10-21T10:00:00Z", paidOn: null, revision: 3, ...over,
  };
}

const counts = { waitingForMe: 0, needsTreasurer: 2, waitingForPayment: 5, inProgress: 1 };

function arrange(over: Record<string, unknown> = {}, has: Partial<typeof identity.has> = {}) {
  gate.mockResolvedValue(okGate(has));
  reads.listTreasurerRequests.mockResolvedValue({ kind: "ok", items: [row()], total: 1 });
  reads.listTreasurerGroups.mockResolvedValue({ kind: "ok", groups: [{ id: G1, name: "Property Committee" }, { id: G2, name: "Worship" }], truncated: false });
  reads.getCounts.mockResolvedValue({ kind: "ok", counts });
  reads.getPayHolderCount.mockResolvedValue(2);
  for (const [k, v] of Object.entries(over)) (reads as Record<string, ReturnType<typeof vi.fn>>)[k]!.mockResolvedValue(v);
}

beforeEach(() => {
  gate.mockReset();
  team.listTreasuryTeam.mockReset();
  for (const fn of Object.values(reads)) fn.mockReset();
});
afterEach(cleanup);

describe("gate states render honestly on every treasurer page", () => {
  const pages: Array<[string, () => Promise<unknown>]> = [
    ["queue", () => QueuePage({ params, searchParams: search() })],
    ["request", () => RequestPage({ params: idParams })],
    ["settings", () => SettingsPage({ params })],
    ["team", () => TeamPage({ params })],
  ];

  it.each([
    [{ kind: "forbidden", name: "Alder Creek" }, COPY.queue.forbidden("Alder Creek")],
    [{ kind: "toggle_off", name: "Alder Creek", canManageFeatures: false }, COPY.page.toggleOff("Alder Creek")],
    [{ kind: "not_applicable", name: "Alder Creek" }, COPY.page.notApplicable],
    [{ kind: "load_error" }, COPY.queue.loadError],
  ])("%j", async (state, text) => {
    for (const [, page] of pages) {
      gate.mockResolvedValue({ ok: false, state });
      const { node } = await call(page);
      render(<>{node}</>);
      expect(document.body.textContent).toContain(text);
      cleanup();
    }
  });

  it("the gate is asked with each page's own path and the key it needs", async () => {
    gate.mockResolvedValue({ ok: false, state: { kind: "load_error" } });
    await call(() => QueuePage({ params, searchParams: search() }));
    expect(gate).toHaveBeenLastCalledWith({ slug: "alder", path: "/o/alder/admin/reimbursements", anyOf: ["view"] });
    await call(() => RequestPage({ params: idParams }));
    expect(gate).toHaveBeenLastCalledWith({ slug: "alder", path: `/o/alder/admin/reimbursements/${ID}`, anyOf: ["view"] });
    await call(() => SettingsPage({ params }));
    expect(gate).toHaveBeenLastCalledWith({ slug: "alder", path: "/o/alder/admin/reimbursements/settings", anyOf: ["manage"] });
    await call(() => TeamPage({ params }));
    expect(gate).toHaveBeenLastCalledWith({ slug: "alder", path: "/o/alder/admin/reimbursements/team", anyOf: ["manage"] });
  });
});

describe("the queue", () => {
  it("shows the five tabs with their counts, the open one marked, and each link keeps the filters", async () => {
    arrange();
    render(<>{(await call(() => QueuePage({ params, searchParams: search({ tab: "paid", group: G1, from: "2026-01-02" }) }))).node}</>);
    const nav = screen.getByTestId("queue-tabs");
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual([
      "Waiting for payment(5)",
      "Needs treasurer approval(2)",
      "In progress(1)",
      "Paid",
      "All",
    ]);
    expect(links.filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent)).toEqual(["Paid"]);
    expect(links[0]!.getAttribute("href")).toBe(`/o/alder/admin/reimbursements?tab=pay&group=${G1}&from=2026-01-02`);
  });

  it("builds everything from the PARSED query: junk is dropped, the filter bar shows what was applied (X7)", async () => {
    arrange();
    render(<>{(await call(() => QueuePage({ params, searchParams: search({ tab: "bogus", group: "nope", from: "2026-13-45", to: "x", page: "-4" }) }))).node}</>);
    expect(reads.listTreasurerRequests).toHaveBeenCalledWith(expect.anything(), { tab: "pay", groupId: null, from: null, to: null, page: 1 });
    expect((screen.getByLabelText(COPY.queue.filter.submittedFrom) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(COPY.queue.chargedTo) as HTMLSelectElement).value).toBe("");
    expect(screen.getByTestId("export-csv").getAttribute("href")).toBe("/o/alder/admin/reimbursements/export?status=approved");
    expect(screen.queryByRole("link", { name: COPY.queue.filter.clear })).toBeNull();
  });

  it("the filter bar has Copy's labels, the dates hint, Filter, and Clear once a filter is set; Export CSV carries the dates", async () => {
    arrange();
    render(<>{(await call(() => QueuePage({ params, searchParams: search({ tab: "all", from: "2026-01-02", to: "2026-02-03" }) }))).node}</>);
    for (const label of [COPY.queue.chargedTo, COPY.queue.filter.submittedFrom, COPY.queue.filter.submittedTo]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByText(COPY.queue.filter.datesHint)).toBeTruthy();
    expect(screen.getByRole("button", { name: COPY.queue.filter.apply })).toBeTruthy();
    expect(screen.getByRole("link", { name: COPY.queue.filter.clear }).getAttribute("href")).toBe("/o/alder/admin/reimbursements?tab=all");
    expect(screen.getByTestId("export-csv").getAttribute("href")).toBe("/o/alder/admin/reimbursements/export?from=2026-01-02&to=2026-02-03");
    expect((document.querySelector('input[name="tab"]') as HTMLInputElement).value).toBe("all");
    const select = screen.getByLabelText(COPY.queue.chargedTo) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["All groups", "Property Committee", "Worship"]);
  });

  it("the 2,000-request hint shows only when the group list is cut off", async () => {
    arrange();
    render(<>{(await call(() => QueuePage({ params, searchParams: search() }))).node}</>);
    expect(screen.queryByText(COPY.queue.filter.groupsTruncated)).toBeNull();
    cleanup();
    arrange({ listTreasurerGroups: { kind: "ok", groups: [{ id: G1, name: "Property Committee" }], truncated: true } });
    render(<>{(await call(() => QueuePage({ params, searchParams: search() }))).node}</>);
    expect(screen.getByText(COPY.queue.filter.groupsTruncated)).toBeTruthy();
  });

  it("a selected group that the list lacks stays selected as 'This group'", async () => {
    arrange();
    render(<>{(await call(() => QueuePage({ params, searchParams: search({ group: "33333333-3333-4333-8333-333333333333" }) }))).node}</>);
    const select = screen.getByLabelText(COPY.queue.chargedTo) as HTMLSelectElement;
    expect(select.value).toBe("33333333-3333-4333-8333-333333333333");
    expect(select.selectedOptions[0]!.textContent).toBe("This group");
  });

  it("each row is one link to the treasurer's request page with the payee, amount, group, 'Approved {date}', the status and the on-behalf badge", async () => {
    arrange({ listTreasurerRequests: { kind: "ok", total: 2, items: [row({ enteredOnBehalf: true }), row({ id: G2, status: "submitted", approvedAt: null })] } });
    render(<>{(await call(() => QueuePage({ params, searchParams: search() }))).node}</>);
    const rows = screen.getAllByTestId("queue-row");
    expect(rows[0]!.getAttribute("href")).toBe(`/o/alder/admin/reimbursements/${ID}`);
    expect(rows[0]!.textContent).toContain("Tamsin Brightwater");
    expect(rows[0]!.textContent).toContain("$42.50");
    expect(rows[0]!.textContent).toContain("Charged to Property Committee");
    expect(rows[0]!.textContent).toMatch(/Approved /);
    expect(rows[0]!.textContent).toContain("Approved, waiting for payment");
    expect(rows[0]!.textContent).toContain(COPY.queue.enteredOnBehalfBadge);
    expect(rows[1]!.textContent).toMatch(/Sent /);
    expect(rows[1]!.textContent).not.toContain(COPY.queue.enteredOnBehalfBadge);
  });

  it("an empty tab says its own sentence; any filter says 'No requests match those filters.' (S7)", async () => {
    for (const [tab, text] of [
      ["pay", COPY.queue.empty.pay], ["override", COPY.queue.empty.override], ["progress", COPY.queue.empty.progress],
      ["paid", COPY.queue.empty.paid], ["all", COPY.queue.empty.all],
    ] as const) {
      arrange({ listTreasurerRequests: { kind: "ok", items: [], total: 0 } });
      render(<>{(await call(() => QueuePage({ params, searchParams: search({ tab }) }))).node}</>);
      expect(screen.getByTestId("queue-empty").textContent).toBe(text);
      cleanup();
    }
    arrange({ listTreasurerRequests: { kind: "ok", items: [], total: 0 } });
    render(<>{(await call(() => QueuePage({ params, searchParams: search({ tab: "paid", from: "2026-01-02" }) }))).node}</>);
    expect(screen.getByTestId("queue-empty").textContent).toBe(COPY.queue.empty.filtered);
  });

  it("the override tab carries its note, and only that tab", async () => {
    arrange();
    render(<>{(await call(() => QueuePage({ params, searchParams: search({ tab: "override" }) }))).node}</>);
    expect(screen.getByTestId("override-tab-note").textContent).toBe(COPY.queue.overrideTabNote);
    cleanup();
    render(<>{(await call(() => QueuePage({ params, searchParams: search({ tab: "pay" }) }))).node}</>);
    expect(screen.queryByTestId("override-tab-note")).toBeNull();
  });

  it("X6: a page past the last (no rows, total 0) goes to page 1 of the same filters; it never prints 'page 2 of 0'", async () => {
    arrange({ listTreasurerRequests: { kind: "ok", items: [], total: 0 } });
    const { thrown } = await call(() => QueuePage({ params, searchParams: search({ tab: "paid", group: G1, page: "3" }) }));
    expect(thrown).toBe(`REDIRECT:/o/alder/admin/reimbursements?tab=paid&group=${G1}`);
  });

  it("pages: 51 rows is two pages, with links that keep the filters", async () => {
    arrange({ listTreasurerRequests: { kind: "ok", items: [row()], total: 51 } });
    render(<>{(await call(() => QueuePage({ params, searchParams: search({ tab: "all", to: "2026-02-03" }) }))).node}</>);
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Next" }).getAttribute("href")).toBe("/o/alder/admin/reimbursements?tab=all&to=2026-02-03&page=2");
  });

  it("the no-pay-holder banner appears only at zero", async () => {
    arrange({ getPayHolderCount: 0 });
    render(<>{(await call(() => QueuePage({ params, searchParams: search() }))).node}</>);
    expect(screen.getByTestId("no-pay-holder").textContent).toBe(COPY.queue.noPayHolder);
    cleanup();
    arrange();
    render(<>{(await call(() => QueuePage({ params, searchParams: search() }))).node}</>);
    expect(screen.queryByTestId("no-pay-holder")).toBeNull();
  });

  it("Settings and Treasury team are offered to a manage holder only", async () => {
    arrange();
    render(<>{(await call(() => QueuePage({ params, searchParams: search() }))).node}</>);
    expect(screen.queryByRole("link", { name: COPY.settings.heading })).toBeNull();
    expect(screen.queryByRole("link", { name: COPY.team.heading })).toBeNull();
    cleanup();
    arrange({}, { manage: true });
    render(<>{(await call(() => QueuePage({ params, searchParams: search() }))).node}</>);
    expect(screen.getByRole("link", { name: COPY.settings.heading }).getAttribute("href")).toBe("/o/alder/admin/reimbursements/settings");
    expect(screen.getByRole("link", { name: COPY.team.heading }).getAttribute("href")).toBe("/o/alder/admin/reimbursements/team");
  });

  it("a failed or refused read is a load error, never an empty queue", async () => {
    for (const [name, over] of [
      ["throws", () => reads.listTreasurerRequests.mockRejectedValue(new Error("db"))],
      ["groups denied", () => reads.listTreasurerGroups.mockResolvedValue({ kind: "denied" })],
      ["list denied", () => reads.listTreasurerRequests.mockResolvedValue({ kind: "denied" })],
      ["counts denied", () => reads.getCounts.mockResolvedValue({ kind: "denied" })],
    ] as const) {
      arrange();
      over();
      render(<>{(await call(() => QueuePage({ params, searchParams: search() }))).node}</>);
      expect(screen.getByRole("alert").textContent, name).toBe(COPY.queue.loadError);
      expect(screen.queryByTestId("queue-empty"), name).toBeNull();
      cleanup();
    }
  });

  it("opening the queue reads and writes nothing else: it makes exactly the four reads", async () => {
    arrange();
    await call(() => QueuePage({ params, searchParams: search() }));
    expect(reads.listTreasurerRequests).toHaveBeenCalledTimes(1);
    expect(reads.listTreasurerGroups).toHaveBeenCalledTimes(1);
    expect(reads.getCounts).toHaveBeenCalledTimes(1);
    expect(reads.getPayHolderCount).toHaveBeenCalledTimes(1);
  });
});

describe("the treasurer's request page", () => {
  function treasury(over: Record<string, unknown> = {}, viewer: Record<string, unknown> = {}) {
    return {
      level: "treasury", id: ID, status: "approved", kind: "reimburse", origin: "app", revision: 4, amountCents: 4250, currency: "usd",
      expenseDate: "2026-10-20", purpose: "Folding tables", preApprovedByName: null, noReceiptClaimed: false,
      createdAt: "2026-10-20T10:00:00Z", firstSubmittedAt: "2026-10-20T10:00:00Z", submittedAt: "2026-10-20T10:00:00Z", updatedAt: "2026-10-20T10:00:00Z",
      group: { id: G1, name: "Property Committee" }, category: null, payee: { kind: "person", name: "Tamsin Brightwater", personId: "p" },
      enteredOnBehalf: false,
      receipts: [{ id: G2, displayName: "receipt.jpg", contentType: "image/jpeg", byteSize: 10, createdAt: "2026-10-20T10:00:00Z" }],
      receiptWaived: false, approvedOn: "2026-10-21", decidedOn: "2026-10-21", latestReason: null, route: null, paidOn: null, duplicateReceipt: null,
      viewer: { relation: "treasury", canEdit: false, canWithdraw: false, canDecide: false },
      history: [
        { kind: "created", on: "2026-10-20", at: "2026-10-20T09:00:00Z", actorName: "Tamsin Brightwater" },
        { kind: "approved", on: "2026-10-21", at: "2026-10-21T10:00:00Z", actorName: "Pat Quill" },
        { kind: "note", on: "2026-10-22", at: "2026-10-22T10:00:00Z", actorName: "Rowan Pell", note: "Called the vendor." },
      ],
      creatorName: "Tamsin Brightwater",
      approval: { path: "seat", byName: "Pat Quill", revision: 4, at: "2026-10-21T10:00:00Z" },
      waiver: null, duplicateRequestIds: [],
      payments: [],
      treasuryViewer: { holdsPay: true, holdsManage: false, isApprover: false, isRequesterSide: false, seatHolderExists: false, secondPayerExists: true, anotherPayerExists: true, ...viewer },
      ...over,
    };
  }
  const arrangeDetail = (detail: unknown) => {
    gate.mockResolvedValue(okGate({ pay: true }));
    reads.getRequestDetail.mockResolvedValue({ kind: "ok", detail });
    reads.getOrgToday.mockResolvedValue("2026-10-26");
  };

  it.each([
    ["not_found", { kind: "not_found" }],
    ["denied", { kind: "denied" }],
    ["a member-level projection", { kind: "ok", detail: { level: "member" } }],
  ])("%s is the one neutral 404", async (_n, result) => {
    gate.mockResolvedValue(okGate());
    reads.getRequestDetail.mockResolvedValue(result);
    reads.getOrgToday.mockResolvedValue("2026-10-26");
    const { thrown } = await call(() => RequestPage({ params: idParams }));
    expect(thrown).toBe("NOT_FOUND");
  });

  it("asks for the TREASURY level, and a thrown read is a load error", async () => {
    gate.mockResolvedValue(okGate());
    reads.getRequestDetail.mockRejectedValue(new Error("db"));
    reads.getOrgToday.mockResolvedValue("2026-10-26");
    render(<>{(await call(() => RequestPage({ params: idParams }))).node}</>);
    expect(reads.getRequestDetail).toHaveBeenCalledWith(expect.anything(), ID, "treasury");
    expect(screen.getByRole("alert").textContent).toBe(COPY.queue.loadError);
  });

  it("shows the facts, who approved on which path, and the history WITH names (treasury level only)", async () => {
    arrangeDetail(treasury());
    render(<>{(await call(() => RequestPage({ params: idParams }))).node}</>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("$42.50");
    expect(screen.getByTestId("request-fields").textContent).toContain("Property Committee");
    expect(screen.getByTestId("approved-by").textContent).toMatch(/^Approved by Pat Quill on /);
    expect(screen.getByTestId("approved-by").textContent).not.toContain("as treasurer");
    const history = screen.getByTestId("request-history").textContent!;
    expect(history).toContain("Rowan Pell");
    expect(history).toContain("Called the vendor.");
    expect(screen.getByRole("link", { name: "receipt.jpg" }).getAttribute("href")).toBe(`/o/alder/reimbursements/${ID}/receipts/${G2}`);
    expect(screen.getByRole("link", { name: COPY.detail.back }).getAttribute("href")).toBe("/o/alder/admin/reimbursements");
  });

  it("an override approval says 'as treasurer'", async () => {
    arrangeDetail(treasury({ approval: { path: "override", byName: "Rowan Pell", revision: 4, at: "2026-10-21T10:00:00Z" } }));
    render(<>{(await call(() => RequestPage({ params: idParams }))).node}</>);
    expect(screen.getByTestId("approved-by").textContent).toMatch(/^Approved by Rowan Pell on .* as treasurer$/);
  });

  it("the payment area is the form for a payable request and the Copy sentence when it cannot be paid by this viewer", async () => {
    arrangeDetail(treasury());
    render(<>{(await call(() => RequestPage({ params: idParams }))).node}</>);
    expect(screen.getByTestId("payment-form")).toBeTruthy();
    cleanup();
    arrangeDetail(treasury({}, { isApprover: true }));
    render(<>{(await call(() => RequestPage({ params: idParams }))).node}</>);
    expect(screen.queryByTestId("payment-form")).toBeNull();
    expect(screen.getByTestId("payment-block").textContent).toBe(COPY.treasury.blocks.approverCannotPay);
  });

  it("a paid request lists the payment (method, reference, recorder), the self-paid line, and offers Reverse", async () => {
    arrangeDetail(
      treasury({
        status: "paid", paidOn: "2026-10-25",
        payments: [{ id: ID, kind: "payment", method: "check", reference: "1001", paidOn: "2026-10-25", amountCents: 4250, byName: "Rowan Pell", selfPaid: true, note: null, offsetsPaymentId: null, reason: null, createdAt: "2026-10-25T10:00:00Z", reversed: false }],
      }),
    );
    render(<>{(await call(() => RequestPage({ params: idParams }))).node}</>);
    const payment = screen.getByTestId("payment-row");
    expect(payment.textContent).toContain("Check");
    expect(payment.textContent).toContain("Check number 1001");
    expect(payment.textContent).toContain("Rowan Pell");
    expect(payment.textContent).toContain(COPY.treasury.extras.selfPaid);
    expect(screen.getByTestId("reverse-open").textContent).toBe(COPY.treasury.buttons.reversePayment);
    expect(screen.getByTestId("payment-block").textContent).toBe(COPY.treasury.blocks.alreadyPaid);
  });

  it("the duplicate-receipt flag links to the earlier request (treasury only)", async () => {
    arrangeDetail(treasury({ duplicateReceipt: true, duplicateRequestIds: [G2] }));
    render(<>{(await call(() => RequestPage({ params: idParams }))).node}</>);
    expect(screen.getByTestId("flag-duplicate-receipt").textContent).toContain(COPY.detail.duplicateReceipt);
    expect(screen.getByRole("link", { name: COPY.detail.viewDuplicate }).getAttribute("href")).toBe(`/o/alder/admin/reimbursements/${G2}`);
  });

  it("a view-only holder is offered the note and nothing else", async () => {
    arrangeDetail(treasury({}, { holdsPay: false }));
    render(<>{(await call(() => RequestPage({ params: idParams }))).node}</>);
    expect(screen.getByTestId("note-open")).toBeTruthy();
    for (const id of ["reverse-open", "waive-open", "treasury-send-back-open", "void-open", "override-open"]) expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.queryByTestId("payment-area")).toBeNull();
  });
});

describe("the settings page", () => {
  const settings = (over: Record<string, unknown> = {}) => ({
    kind: "ok",
    settings: {
      groups: [
        { id: G1, name: "Property Committee", membershipSource: "managed", chargeable: true, approverCount: 2 },
        { id: G2, name: "Session", membershipSource: "derived", chargeable: false, approverCount: 0 },
      ],
      categories: [{ id: ID, name: "Supplies", sortOrder: 0 }],
      payHolderCount: 1,
      ...over,
    },
  });

  it("lists the groups with the live approver note and the categories", async () => {
    gate.mockResolvedValue(okGate({ manage: true }));
    reads.getSettings.mockResolvedValue(settings());
    render(<>{(await call(() => SettingsPage({ params }))).node}</>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(COPY.settings.heading);
    const rows = screen.getAllByTestId("chargeable-row");
    expect(rows[0]!.textContent).toContain("2 chairs or leaders can approve.");
    expect(rows[1]!.textContent).toContain("No chair or leader: requests go to the treasurer.");
    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(screen.queryByTestId("no-chargeable-groups")).toBeNull();
    expect(screen.getByTestId("category-row").textContent).toContain("Supplies");
    expect(screen.getByText(COPY.settings.categoriesHint)).toBeTruthy();
  });

  it("says so, plainly, when no group can receive requests yet", async () => {
    gate.mockResolvedValue(okGate({ manage: true }));
    reads.getSettings.mockResolvedValue(
      settings({ groups: [{ id: G2, name: "Session", membershipSource: "derived", chargeable: false, approverCount: 0 }] }),
    );
    render(<>{(await call(() => SettingsPage({ params }))).node}</>);
    expect(screen.getByTestId("no-chargeable-groups").textContent).toBe(COPY.settings.noGroups);
  });

  it("denied or a thrown read is a load error", async () => {
    gate.mockResolvedValue(okGate({ manage: true }));
    reads.getSettings.mockResolvedValue({ kind: "denied" });
    render(<>{(await call(() => SettingsPage({ params }))).node}</>);
    expect(screen.getByRole("alert").textContent).toBe(COPY.queue.loadError);
    cleanup();
    reads.getSettings.mockRejectedValue(new Error("db"));
    render(<>{(await call(() => SettingsPage({ params }))).node}</>);
    expect(screen.getByRole("alert").textContent).toBe(COPY.queue.loadError);
  });
});

describe("the team page", () => {
  const teamData = (over: Record<string, unknown> = {}) => ({
    kind: "ok",
    grants: [{ grantId: G1, roleId: G2, roleKey: "treasurer", roleName: "Treasurer", grantee: { kind: "person", personId: "p", displayName: "Rowan Pell" }, startsOn: "2026-01-02", ownKeys: ["reimbursement.manage"], endableHere: true }],
    assignableRoles: [{ id: G2, key: "treasurer", name: "Treasurer", ownKeys: ["reimbursement.manage"] }],
    people: [{ personId: "p2", displayName: "Pat Quill" }],
    missingTemplates: [],
    ...over,
  });

  it("shows the intro, who holds a role, and the give-a-role form; no set-up section when nothing is missing", async () => {
    gate.mockResolvedValue(okGate({ manage: true }));
    team.listTreasuryTeam.mockResolvedValue(teamData());
    render(<>{(await call(() => TeamPage({ params }))).node}</>);
    expect(team.listTreasuryTeam).toHaveBeenCalledWith("reimbursement", "person-1", "org-1");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(COPY.team.heading);
    expect(screen.getByText(COPY.team.intro("Alder Creek"))).toBeTruthy();
    expect(screen.getByRole("heading", { name: COPY.team.sectionHolders })).toBeTruthy();
    expect(screen.getByTestId("team-row").textContent).toContain("Rowan Pell");
    expect(screen.queryByRole("heading", { name: COPY.team.sectionSetup })).toBeNull();
    expect(screen.getByTestId("team-grant-form")).toBeTruthy();
  });

  it("offers the missing templates by Copy's names, the clerk with its description", async () => {
    gate.mockResolvedValue(okGate({ manage: true }));
    team.listTreasuryTeam.mockResolvedValue(teamData({ missingTemplates: ["treasurer", "reimbursement_clerk"] }));
    render(<>{(await call(() => TeamPage({ params }))).node}</>);
    expect(screen.getByRole("button", { name: COPY.team.setUpTreasurer })).toBeTruthy();
    expect(screen.getByRole("button", { name: COPY.team.setUpClerk })).toBeTruthy();
    expect(screen.getByText(COPY.team.clerkDescription)).toBeTruthy();
    expect(screen.getByText(COPY.team.panel.setupIntroMany)).toBeTruthy();
  });

  it("a forbidden or thrown read is a load error, never an empty team", async () => {
    gate.mockResolvedValue(okGate({ manage: true }));
    team.listTreasuryTeam.mockResolvedValue({ kind: "forbidden" });
    render(<>{(await call(() => TeamPage({ params }))).node}</>);
    expect(screen.getByRole("alert").textContent).toBe(COPY.queue.loadError);
    cleanup();
    team.listTreasuryTeam.mockRejectedValue(new Error("db"));
    render(<>{(await call(() => TeamPage({ params }))).node}</>);
    expect(screen.getByRole("alert").textContent).toBe(COPY.queue.loadError);
  });
});
