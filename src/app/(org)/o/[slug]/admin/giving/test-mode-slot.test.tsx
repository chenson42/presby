// @vitest-environment jsdom
/**
 * The test-mode badge slot (docs/work-log/2026-10-15-online-giving.md, G14),
 * which `layout.tsx` renders above every giving admin page. It must show the
 * badge ONLY to someone who would pass the page gate, ONLY for a test-mode
 * OPEN connection, and fail silent on anything else.
 */
import { Children, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: () => cachedAuth() }));
const resolveOrgContext = vi.fn();
vi.mock("@/lib/authz", () => ({ resolveOrgContext: (...a: unknown[]) => resolveOrgContext(...a) }));
const assertGivingSession = vi.fn();
const loadGivingContext = vi.fn();
vi.mock("@/lib/giving/access", () => ({
  assertGivingSession: (...a: unknown[]) => assertGivingSession(...a),
  loadGivingContext: (...a: unknown[]) => loadGivingContext(...a),
}));
const readOpenConnectionMode = vi.fn();
vi.mock("@/lib/giving/connection", () => ({ readOpenConnectionMode: (...a: unknown[]) => readOpenConnectionMode(...a) }));

import { TestModeSlot } from "./test-mode-slot";
import GivingAdminLayout from "./layout";

const OK = { kind: "ok", org: { personId: "p1", organizationId: "o1", organizationType: "congregation" } };

function arrange() {
  cachedAuth.mockResolvedValue({ user: { id: "u1" } });
  assertGivingSession.mockReturnValue({ kind: "ok", userId: "u1" });
  resolveOrgContext.mockResolvedValue(OK);
  loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: true, record: false, manage: false } });
  readOpenConnectionMode.mockResolvedValue("test");
}
afterEach(() => {
  cleanup();
  for (const fn of [cachedAuth, resolveOrgContext, assertGivingSession, loadGivingContext, readOpenConnectionMode]) fn.mockReset();
});

const show = async () => render((await TestModeSlot({ slug: "alder-creek" })) ?? <span data-testid="nothing" />);

describe("TestModeSlot", () => {
  it("renders the badge for a gate-passing viewer when the open connection is test mode", async () => {
    arrange();
    await show();
    expect(screen.getByTestId("giving-test-mode-badge")).toBeTruthy();
    expect(readOpenConnectionMode).toHaveBeenCalledWith("p1", "o1");
  });

  it.each(["live", "none"])("renders nothing when the open connection is %s", async (mode) => {
    arrange();
    readOpenConnectionMode.mockResolvedValue(mode);
    await show();
    expect(screen.getByTestId("nothing")).toBeTruthy();
  });

  it("renders nothing, and reads no connection, for a signed-out visitor", async () => {
    cachedAuth.mockResolvedValue(null);
    await show();
    expect(screen.getByTestId("nothing")).toBeTruthy();
    expect(readOpenConnectionMode).not.toHaveBeenCalled();
  });

  it("renders nothing while 2FA is unmet", async () => {
    arrange();
    assertGivingSession.mockReturnValue({ kind: "two_factor_required" });
    await show();
    expect(screen.getByTestId("nothing")).toBeTruthy();
    expect(readOpenConnectionMode).not.toHaveBeenCalled();
  });

  it.each([
    ["forbidden", { kind: "forbidden" }],
    ["toggle off", { kind: "toggle_off", canManageFeatures: true }],
    ["not applicable", { kind: "not_applicable" }],
  ])("tells an outsider nothing: %s", async (_label, context) => {
    arrange();
    loadGivingContext.mockResolvedValue(context);
    await show();
    expect(screen.getByTestId("nothing")).toBeTruthy();
    expect(readOpenConnectionMode).not.toHaveBeenCalled();
  });

  it("S4: a record-only holder gets no badge (it would reveal provider state) and no connection read", async () => {
    arrange();
    loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: false, record: true, manage: false } });
    await show();
    expect(screen.getByTestId("nothing")).toBeTruthy();
    expect(readOpenConnectionMode).not.toHaveBeenCalled();
  });

  it("a manage-only holder does get it", async () => {
    arrange();
    loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: false, record: false, manage: true } });
    await show();
    expect(screen.getByTestId("giving-test-mode-badge")).toBeTruthy();
  });

  it("renders nothing for a non-member (the four-way miss is the page's job)", async () => {
    arrange();
    resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "X", organizationType: "congregation" });
    await show();
    expect(screen.getByTestId("nothing")).toBeTruthy();
    expect(loadGivingContext).not.toHaveBeenCalled();
  });

  it("any failure is silent: a missing badge never takes a page down", async () => {
    arrange();
    readOpenConnectionMode.mockRejectedValue(new Error("connection reset"));
    await show();
    expect(screen.getByTestId("nothing")).toBeTruthy();
  });
});

describe("GivingAdminLayout", () => {
  it("puts the slot (for THIS slug) above the page body on every giving page, and adds no auth of its own", async () => {
    const tree = (await GivingAdminLayout({
      children: <p>page body</p>,
      params: Promise.resolve({ slug: "alder-creek" }),
    })) as ReactElement<{ children: ReactNode }>;
    const [slot, body] = Children.toArray(tree.props.children) as ReactElement<{ slug?: string }>[];
    expect(slot!.type).toBe(TestModeSlot);
    expect(slot!.props.slug).toBe("alder-creek");
    expect(body!.type).toBe("p");
    // the layout itself reads no session and no connection: the slot is the only reader
    expect(cachedAuth).not.toHaveBeenCalled();
    expect(readOpenConnectionMode).not.toHaveBeenCalled();
  });
});
