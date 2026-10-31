/**
 * The /admin/messages Server Actions: the gate is `FEATURES.ADMIN_TICKETS` on
 * EVERY call (a directly-invoked action is not protected by the page's own
 * check), the id is a UUID before anything else happens, and `inbox.ts`
 * (mocked here; its writes are inbox.db.test.ts) is reached only after both.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FEATURES } from "@/lib/permissions";

vi.mock("server-only", () => ({}));
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
const inbox = vi.hoisted(() => ({
  setMessageStatus: vi.fn(),
  clearMessageDetails: vi.fn(),
}));
vi.mock("@/lib/help-contact/inbox", () => ({
  isMessageId: (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  setMessageStatus: inbox.setMessageStatus,
  clearMessageDetails: inbox.clearMessageDetails,
}));

import { clearContactMessageDetails, setContactMessageStatus } from "./actions";

const ID = "11111111-2222-4333-8444-555555555555";
const OPERATOR = {
  user: { id: "99999999-2222-4333-8444-555555555555", email: "operator@example.invalid", features: [FEATURES.ADMIN_TICKETS] },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe.each([
  ["setContactMessageStatus", () => setContactMessageStatus(ID, "handled"), inbox.setMessageStatus],
  ["clearContactMessageDetails", () => clearContactMessageDetails(ID), inbox.clearMessageDetails],
] as const)("%s: the gate", (_name, call, reach) => {
  it("refuses with no session", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await call()).toEqual({ ok: false, error: "Not signed in." });
    expect(reach).not.toHaveBeenCalled();
  });

  it("refuses a signed-in user without admin.tickets, even one with every other admin key", async () => {
    mockAuth.mockResolvedValue({
      user: { ...OPERATOR.user, features: Object.values(FEATURES).filter((f) => f !== FEATURES.ADMIN_TICKETS) },
    });
    expect(await call()).toEqual({ ok: false, error: "Forbidden." });
    expect(reach).not.toHaveBeenCalled();
  });
});

describe("setContactMessageStatus", () => {
  it("passes the actor and the target to inbox.ts and refreshes both pages", async () => {
    mockAuth.mockResolvedValue(OPERATOR);
    inbox.setMessageStatus.mockResolvedValue({ ok: true });
    expect(await setContactMessageStatus(ID, "spam")).toEqual({ ok: true });
    expect(inbox.setMessageStatus).toHaveBeenCalledWith(
      { userId: OPERATOR.user.id, email: OPERATOR.user.email },
      ID,
      "spam",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/messages");
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/messages/${ID}`);
  });

  it("a non-UUID id and an unknown status never reach inbox.ts", async () => {
    mockAuth.mockResolvedValue(OPERATOR);
    expect(await setContactMessageStatus("not-an-id", "handled")).toEqual({
      ok: false,
      error: "That message could not be found.",
    });
    expect(await setContactMessageStatus(ID, "archived" as never)).toEqual({
      ok: false,
      error: "Could not change the status. Try again.",
    });
    expect(inbox.setMessageStatus).not.toHaveBeenCalled();
  });

  it("maps each refusal to its Copy D sentence and does not refresh", async () => {
    mockAuth.mockResolvedValue(OPERATOR);
    inbox.setMessageStatus.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    expect(await setContactMessageStatus(ID, "handled")).toEqual({ ok: false, error: "That message could not be found." });
    inbox.setMessageStatus.mockResolvedValueOnce({ ok: false, reason: "cleared_cannot_be_new" });
    expect(await setContactMessageStatus(ID, "new")).toEqual({
      ok: false,
      error: "A message whose details were cleared cannot go back to new.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("a throw becomes the failure sentence and logs only the error class, never its message", async () => {
    mockAuth.mockResolvedValue(OPERATOR);
    inbox.setMessageStatus.mockRejectedValue(new Error("detail: Seed Name 123 leaked"));
    expect(await setContactMessageStatus(ID, "handled")).toEqual({ ok: false, error: "Could not change the status. Try again." });
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logged).toContain("Error");
    expect(logged).not.toContain("Seed Name");
  });
});

describe("clearContactMessageDetails", () => {
  it("clears and refreshes", async () => {
    mockAuth.mockResolvedValue(OPERATOR);
    inbox.clearMessageDetails.mockResolvedValue({ ok: true });
    expect(await clearContactMessageDetails(ID)).toEqual({ ok: true });
    expect(inbox.clearMessageDetails).toHaveBeenCalledWith({ userId: OPERATOR.user.id, email: OPERATOR.user.email }, ID);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/messages");
  });

  it("maps each refusal to its Copy D sentence", async () => {
    mockAuth.mockResolvedValue(OPERATOR);
    for (const [reason, error] of [
      ["not_found", "That message could not be found."],
      ["already_cleared", "Its details were already cleared."],
      ["needs_triage", "Mark the message as handled or spam before clearing its details."],
    ] as const) {
      inbox.clearMessageDetails.mockResolvedValueOnce({ ok: false, reason });
      expect(await clearContactMessageDetails(ID)).toEqual({ ok: false, error });
    }
  });

  it("a throw becomes the failure sentence", async () => {
    mockAuth.mockResolvedValue(OPERATOR);
    inbox.clearMessageDetails.mockRejectedValue(new Error("x"));
    expect(await clearContactMessageDetails(ID)).toEqual({ ok: false, error: "Could not clear the details. Try again." });
  });
});

describe("the file's shape", () => {
  it("exports exactly the two actions", async () => {
    const mod = await import("./actions");
    expect(Object.keys(mod).sort()).toEqual(["clearContactMessageDetails", "setContactMessageStatus"]);
  });
});
