/**
 * Orchestration tests for the Stripe connection actions - docs/work-log/
 * 2026-10-15-online-giving.md, Batch 3a. What is proved: every action asks the
 * shared gate for `giving.manage` FIRST and returns its refusal untouched;
 * validation precedes the write; exactly one `connection.ts` call; the audit
 * row is written only after success, from the facts the library returned, with
 * ids / flags / field names and no Stripe account id, name or email; results
 * are the contract 3b consumes.
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
  AUDIT_ACTIONS: new Proxy({}, { get: (_t, key) => String(key) }),
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));
const lib = vi.hoisted(() => ({
  startConnect: vi.fn(),
  continueConnect: vi.fn(),
  refreshConnection: vi.fn(),
  attestPayouts: vi.fn(),
  setPublicPage: vi.fn(),
  updateRates: vi.fn(),
  disconnectConnection: vi.fn(),
}));
vi.mock("@/lib/giving/connection", () => lib);
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import {
  attestPayoutsAction,
  continueConnectAction,
  disconnectAction,
  refreshConnectionAction,
  setPublicPageAction,
  startConnectAction,
  updateRatesAction,
} from "./actions";

const IDENTITY = {
  ok: true, userId: "user-1", email: "tess.manager@example.invalid", personId: "person-1", organizationId: "org-1",
  has: { view: true, record: true, manage: true },
};
const CONN = { personId: "person-1", organizationId: "org-1", userId: "user-1", email: "tess.manager@example.invalid" };
const URL = "https://accounts.stripe.com/r/acct_fixture";

afterEach(() => {
  gate.mockReset();
  recordAudit.mockClear();
  revalidatePath.mockReset();
  for (const fn of Object.values(lib)) fn.mockReset();
});

const everyAction: Array<[string, (slug: string) => Promise<unknown>]> = [
  ["startConnectAction", (s) => startConnectAction(s)],
  ["continueConnectAction", (s) => continueConnectAction(s)],
  ["refreshConnectionAction", (s) => refreshConnectionAction(s)],
  ["attestPayoutsAction", (s) => attestPayoutsAction(s)],
  ["setPublicPageAction", (s) => setPublicPageAction(s, true)],
  ["disconnectAction", (s) => disconnectAction(s)],
  ["updateRatesAction", (s) => updateRatesAction(s, { cardFeeBps: 290, cardFeeFixedCents: 30, achFeeBps: 80, achFeeCapCents: 500 })],
];

describe("every connection action", () => {
  it.each(everyAction)("%s asks the shared gate for giving.manage and returns its refusal untouched", async (_name, run) => {
    for (const refusal of [
      { ok: false, error: "nope" },
      { ok: false, kind: "two_factor_required", error: "2fa", redirectTo: "/totp?callbackUrl=x" },
    ]) {
      gate.mockResolvedValue(refusal);
      expect(await run("alder-creek")).toEqual(refusal);
      expect(gate).toHaveBeenLastCalledWith("alder-creek", ["manage"]);
    }
    for (const fn of Object.values(lib)) expect(fn).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("startConnectAction", () => {
  it("returns the redirect and audits the CREATION (ids and the mode only: no account id, no email)", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.startConnect.mockResolvedValue({ result: { kind: "redirect", url: URL }, created: true, connectionId: "conn-1", livemode: false });
    expect(await startConnectAction("alder-creek")).toEqual({ ok: true, data: { kind: "redirect", url: URL } });
    expect(lib.startConnect).toHaveBeenCalledWith(CONN, "alder-creek");
    expect(recordAudit).toHaveBeenCalledWith({
      action: "GIVING_CONNECTION_CREATED",
      resourceType: "giving_provider_connection",
      resourceId: "conn-1",
      metadata: { organizationId: "org-1", connectionId: "conn-1", livemode: false },
    });
    expect(JSON.stringify(recordAudit.mock.calls)).not.toMatch(/acct_|@example|Tess/);
    expect(revalidatePath).toHaveBeenCalledWith("/o/alder-creek/admin/giving");
  });

  it("audits the creation even when the link then failed, and tells the user to use Continue", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.startConnect.mockResolvedValue({ result: { kind: "provider_error" }, created: true, connectionId: "conn-1", livemode: true });
    const result = await startConnectAction("alder-creek");
    expect(result).toMatchObject({ ok: false, kind: "provider_error", error: expect.stringContaining("Continue") });
    expect(recordAudit).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ kind: "stripe_unconfigured" }, "stripe_unconfigured", "Online giving isn't enabled on this installation."],
    [{ kind: "already_connected" }, "already_connected", expect.stringContaining("already")],
    [{ kind: "provider_error" }, "provider_error", "We couldn't reach Stripe. Nothing was changed."],
  ])("maps %j to a typed failure and writes NO audit row", async (result, kind, error) => {
    gate.mockResolvedValue(IDENTITY);
    lib.startConnect.mockResolvedValue({ result, created: false, connectionId: null, livemode: null });
    expect(await startConnectAction("alder-creek")).toEqual({ ok: false, kind, error });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("a forbidden library result is a plain refusal", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.startConnect.mockResolvedValue({ result: { kind: "forbidden" }, created: false, connectionId: null, livemode: null });
    expect(await startConnectAction("alder-creek")).toMatchObject({ ok: false, error: expect.stringMatching(/permission/) });
  });
});

describe("continueConnectAction / refreshConnectionAction", () => {
  it("continue returns a fresh redirect, and no audit (a link was minted, nothing changed)", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.continueConnect.mockResolvedValue({ kind: "redirect", url: URL });
    expect(await continueConnectAction("alder-creek")).toEqual({ ok: true, data: { kind: "redirect", url: URL } });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "no_connection" }, "no_connection"],
    [{ kind: "stripe_unconfigured" }, "stripe_unconfigured"],
    [{ kind: "provider_error" }, "provider_error"],
  ])("continue maps %j", async (result, kind) => {
    gate.mockResolvedValue(IDENTITY);
    lib.continueConnect.mockResolvedValue(result);
    expect(await continueConnectAction("alder-creek")).toMatchObject({ ok: false, kind });
  });

  it("refresh returns the outcome and status snapshot, and writes no audit of its own (the library audits a change)", async () => {
    gate.mockResolvedValue(IDENTITY);
    const status = { chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, cardEnabled: true, achEnabled: true, requirementsDue: false, disabledReason: null };
    lib.refreshConnection.mockResolvedValue({ kind: "ok", outcome: "applied:status_changed", status });
    expect(await refreshConnectionAction("alder-creek")).toEqual({ ok: true, data: { outcome: "applied:status_changed", status } });
    expect(lib.refreshConnection).toHaveBeenCalledWith(CONN);
    expect(recordAudit).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/o/alder-creek/admin/giving/connect");
  });

  it.each([
    [{ kind: "no_connection" }, "no_connection"],
    [{ kind: "stripe_unconfigured" }, "stripe_unconfigured"],
    [{ kind: "provider_error" }, "provider_error"],
  ])("refresh maps %j", async (result, kind) => {
    gate.mockResolvedValue(IDENTITY);
    lib.refreshConnection.mockResolvedValue(result);
    expect(await refreshConnectionAction("alder-creek")).toMatchObject({ ok: false, kind });
  });
});

describe("attestPayoutsAction", () => {
  it("reports whether it changed anything and revalidates", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.attestPayouts.mockResolvedValue({ kind: "ok", changed: true });
    expect(await attestPayoutsAction("alder-creek")).toEqual({ ok: true, data: { changed: true } });
    lib.attestPayouts.mockResolvedValue({ kind: "ok", changed: false });
    expect(await attestPayoutsAction("alder-creek")).toEqual({ ok: true, data: { changed: false } });
    lib.attestPayouts.mockResolvedValue({ kind: "no_connection" });
    expect(await attestPayoutsAction("alder-creek")).toMatchObject({ ok: false, kind: "no_connection" });
  });
});

describe("setPublicPageAction", () => {
  it("going live audits GIVING_PUBLIC_PAGE_TOGGLED with enabled: true", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.setPublicPage.mockResolvedValue({ kind: "ok", changed: true, connectionId: "conn-1" });
    expect(await setPublicPageAction("alder-creek", true)).toEqual({ ok: true, data: { enabled: true, changed: true } });
    expect(lib.setPublicPage).toHaveBeenCalledWith(CONN, true);
    expect(recordAudit).toHaveBeenCalledWith({
      action: "GIVING_PUBLIC_PAGE_TOGGLED",
      resourceType: "giving_provider_connection",
      resourceId: "conn-1",
      metadata: { organizationId: "org-1", connectionId: "conn-1", enabled: true },
    });
  });

  it("taking it offline audits enabled: false; a no-change toggle writes nothing", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.setPublicPage.mockResolvedValue({ kind: "ok", changed: true, connectionId: "conn-1" });
    await setPublicPageAction("alder-creek", false);
    expect(recordAudit.mock.calls[0]![0].metadata.enabled).toBe(false);
    recordAudit.mockClear();
    lib.setPublicPage.mockResolvedValue({ kind: "ok", changed: false, connectionId: "conn-1" });
    expect(await setPublicPageAction("alder-creek", true)).toEqual({ ok: true, data: { enabled: true, changed: false } });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("coerces anything that is not exactly true to 'take offline' (a truthy string cannot go live)", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.setPublicPage.mockResolvedValue({ kind: "ok", changed: false, connectionId: "conn-1" });
    await setPublicPageAction("alder-creek", "true" as unknown as boolean);
    expect(lib.setPublicPage).toHaveBeenCalledWith(CONN, false);
  });

  it("a refusal names what is missing in words and carries the machine list", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.setPublicPage.mockResolvedValue({ kind: "not_ready", missing: ["online_fund", "payouts_attested"] });
    const result = await setPublicPageAction("alder-creek", true);
    expect(result).toMatchObject({ ok: false, kind: "not_ready", missing: ["online_fund", "payouts_attested"] });
    expect((result as { error: string }).error).toContain("at least one fund");
    expect((result as { error: string }).error).toContain("payouts");
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("disconnectAction", () => {
  it("audits the disconnect with the reason and the schedule count, returns the count for the toast", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.disconnectConnection.mockResolvedValue({ kind: "ok", connectionId: "conn-1", activeSchedules: 3 });
    expect(await disconnectAction("alder-creek")).toEqual({ ok: true, data: { activeSchedules: 3 } });
    expect(recordAudit).toHaveBeenCalledWith({
      action: "GIVING_CONNECTION_DISCONNECTED",
      resourceType: "giving_provider_connection",
      resourceId: "conn-1",
      metadata: { organizationId: "org-1", connectionId: "conn-1", reason: "treasurer", activeSchedules: 3 },
    });
  });

  it("no connection writes nothing", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.disconnectConnection.mockResolvedValue({ kind: "no_connection" });
    expect(await disconnectAction("alder-creek")).toMatchObject({ ok: false, kind: "no_connection" });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("updateRatesAction", () => {
  const GOOD = { cardFeeBps: 220, cardFeeFixedCents: 30, achFeeBps: 80, achFeeCapCents: 500 };

  it("validates BEFORE the write, with a field error per bound", async () => {
    gate.mockResolvedValue(IDENTITY);
    const result = await updateRatesAction("alder-creek", { cardFeeBps: 1001, cardFeeFixedCents: 101, achFeeBps: 501, achFeeCapCents: 2001 });
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { cardFeeBps: expect.any(String), cardFeeFixedCents: expect.any(String), achFeeBps: expect.any(String), achFeeCapCents: expect.any(String) },
    });
    expect(lib.updateRates).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...GOOD, cardFeeBps: -1 }],
    [{ ...GOOD, cardFeeBps: 2.5 }],
    [{ ...GOOD, cardFeeBps: "290" }],
    [{ ...GOOD, cardFeeBps: Number.NaN }],
    [{ cardFeeBps: 290 }],
    [null],
    ["290"],
  ])("rejects %j", async (input) => {
    gate.mockResolvedValue(IDENTITY);
    expect(await updateRatesAction("alder-creek", input)).toMatchObject({ ok: false });
    expect(lib.updateRates).not.toHaveBeenCalled();
  });

  it("accepts the boundary values", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.updateRates.mockResolvedValue({ kind: "ok", changedFields: [], connectionId: "conn-1" });
    expect(await updateRatesAction("alder-creek", { cardFeeBps: 0, cardFeeFixedCents: 0, achFeeBps: 0, achFeeCapCents: 0 })).toEqual({ ok: true });
    expect(await updateRatesAction("alder-creek", { cardFeeBps: 1000, cardFeeFixedCents: 100, achFeeBps: 500, achFeeCapCents: 2000 })).toEqual({ ok: true });
  });

  it("audits the changed field NAMES, not values; a no-change save writes nothing", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.updateRates.mockResolvedValue({ kind: "ok", changedFields: ["cardFeeBps"], connectionId: "conn-1" });
    expect(await updateRatesAction("alder-creek", GOOD)).toEqual({ ok: true });
    expect(lib.updateRates).toHaveBeenCalledWith(CONN, GOOD);
    expect(recordAudit).toHaveBeenCalledWith({
      action: "GIVING_CONNECTION_RATES_CHANGED",
      resourceType: "giving_provider_connection",
      resourceId: "conn-1",
      metadata: { organizationId: "org-1", connectionId: "conn-1", fields: ["cardFeeBps"] },
    });
    recordAudit.mockClear();
    lib.updateRates.mockResolvedValue({ kind: "ok", changedFields: [], connectionId: "conn-1" });
    await updateRatesAction("alder-creek", GOOD);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
