/**
 * Orchestration tests for createMemberGiveSessionAction (docs/work-log/
 * 2026-10-15-online-giving.md, Phase 3 "Member give", Batch 4a). Mocked at the
 * edges (session, the org resolver, the toggle read, the limiter, the database,
 * the Stripe allowlist); the action, `parseGiveForm` and `startGiveSession` run
 * for real. What these pin:
 *
 *   - the gate order: honeypot -> auth -> Node-side 2FA -> resolveOrgContext
 *     -> applicability + toggle -> own membership -> rate limit -> parse -> intent;
 *   - NO giving key is consulted (a plain member may give) - only the toggle;
 *   - `membership_id` is the viewer's own, read server-side, never the form's;
 *   - the limiter is keyed by USER id (no per-site key, no Turnstile);
 *   - session loss is `error`; not-a-member / toggle off / wrong org type are the one `unavailable`.
 */
vi.mock("server-only", () => ({}));

const callLog = vi.hoisted(() => ({ entries: [] as string[] }));

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));

const FakeOrgAccessError = vi.hoisted(() => class FakeOrgAccessError extends Error {});
const mockResolve = vi.hoisted(() => vi.fn());
const mockUserOrgs = vi.hoisted(() => vi.fn());
const mockWithOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  OrgAccessError: FakeOrgAccessError,
  resolveOrgContext: (...a: unknown[]) => mockResolve(...a),
  userOrganizations: (...a: unknown[]) => mockUserOrgs(...a),
  withOrgContext: (...a: unknown[]) => mockWithOrgContext(...a),
}));

const mockToggle = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/access", async () => {
  const pure = await import("@/lib/giving/access-pure");
  return { assertGivingSession: pure.assertGivingSession, loadGivingToggle: (...a: unknown[]) => mockToggle(...a) };
});

const mockRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => mockRateLimit(...a) }));

const mockExecute = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { execute: (...a: unknown[]) => mockExecute(...a) } }));

const mockCreateSession = vi.hoisted(() => vi.fn());
const mockConfigured = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/providers/stripe/client", () => ({
  createCheckoutSession: (...a: unknown[]) => mockCreateSession(...a),
  isStripeConfigured: () => mockConfigured(),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemberGiveSessionAction } from "./actions";

const USER = "11111111-aaaa-4aaa-8aaa-000000000001";
const PERSON = "22222222-aaaa-4aaa-8aaa-000000000002";
const ORG = "33333333-aaaa-4aaa-8aaa-000000000003";
const MEMBERSHIP = "44444444-aaaa-4aaa-8aaa-000000000004";
const FUND = "d9100000-0000-0000-0000-0000000000a1";
const KEY = "3b0f1c2e-5a4d-4c7e-9b1a-6d2f8e0a1c3d";
const INTENT = "5c1f0f6e-1111-4222-8333-444455556666";
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_fixtureSession0001";

function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((c) => (typeof c === "object" && c !== null && "value" in c ? (c as { value: string[] }).value.join("") : "?"))
    .join("");
}
function sqlParams(query: unknown): unknown[] {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks.filter((c) => !(typeof c === "object" && c !== null && "value" in c && Array.isArray((c as { value: unknown }).value)));
}

function giveForm(fields: Record<string, string | undefined> = {}): FormData {
  const base: Record<string, string | undefined> = {
    amount: "50",
    fundId: FUND,
    frequency: "once",
    method: "card",
    idempotencyKey: KEY,
    _hp: "",
    ...fields,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(base)) if (v !== undefined) fd.set(k, v);
  return fd;
}

const okSession = { user: { id: USER, twoFactorRequired: false, twoFactorVerified: false } };
const okOrg = {
  kind: "ok",
  org: { organizationId: ORG, personId: PERSON, name: "Alder Creek", organizationType: "congregation", slug: "alder-creek", platformStatus: "managed" },
};
const membershipRow = { organizationId: ORG, personId: PERSON, membershipId: MEMBERSHIP, endedOn: null };

let intentRow: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  callLog.entries = [];
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
  mockAuth.mockImplementation(async () => {
    callLog.entries.push("auth");
    return okSession;
  });
  mockResolve.mockImplementation(async () => {
    callLog.entries.push("resolve");
    return okOrg;
  });
  mockToggle.mockImplementation(async () => {
    callLog.entries.push("toggle");
    return "on";
  });
  mockUserOrgs.mockImplementation(async () => {
    callLog.entries.push("membership");
    return [membershipRow];
  });
  mockRateLimit.mockImplementation(async (key: string) => {
    callLog.entries.push(`limit:${key}`);
    return { allowed: true };
  });
  mockWithOrgContext.mockImplementation(async (_p: string, _o: string, fn: (tx: unknown) => Promise<unknown>) => {
    callLog.entries.push("withOrgContext");
    return fn({ execute: mockExecute });
  });
  mockConfigured.mockReturnValue(true);
  mockCreateSession.mockImplementation(async () => {
    callLog.entries.push("stripe");
    return { sessionId: "cs_test_fixtureSession0001", url: CHECKOUT_URL };
  });
  intentRow = {
    outcome: "created",
    intent_id: INTENT,
    external_account_id: "acct_fixtureAAAAAAAA1",
    livemode: false,
    fund_name: "General Fund",
    gift_amount_cents: 5000,
    covered_cents: 0,
    total_cents: 5000,
    methods: ["card"],
    already_attached: false,
  };
  mockExecute.mockImplementation(async (q: unknown) => {
    const text = sqlText(q);
    if (text.includes("create_intent_member")) {
      callLog.entries.push("db:create_intent");
      return { rows: [intentRow] };
    }
    if (text.includes("attach_session")) return { rows: [{ attached: true }] };
    return { rows: [] };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.unstubAllEnvs());

describe("the gate, in order", () => {
  it("honeypot -> auth -> resolve -> toggle -> own membership -> limiter -> intent -> Stripe", async () => {
    const result = await createMemberGiveSessionAction("alder-creek", giveForm());
    expect(result).toEqual({ kind: "checkout", url: CHECKOUT_URL });
    expect(callLog.entries.filter((e) => e !== "withOrgContext")).toEqual([
      "auth",
      "resolve",
      "toggle",
      "membership",
      `limit:giving_session_user:${USER}`,
      "limit:giving_session_global",
      "db:create_intent",
      "stripe",
    ]);
  });

  it("a filled honeypot is a fake `unavailable` before anything is read - not even the session", async () => {
    expect(await createMemberGiveSessionAction("alder-creek", giveForm({ _hp: "bot" }))).toEqual({ kind: "unavailable" });
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("a signed-out caller is `error` (a stale session), and nothing else runs", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await createMemberGiveSessionAction("alder-creek", giveForm())).toEqual({ kind: "error" });
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("2FA required and not verified is `error`, before the organization is even resolved", async () => {
    mockAuth.mockResolvedValue({ user: { id: USER, twoFactorRequired: true, twoFactorVerified: false } });
    expect(await createMemberGiveSessionAction("alder-creek", giveForm())).toEqual({ kind: "error" });
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("2FA required AND verified proceeds", async () => {
    mockAuth.mockResolvedValue({ user: { id: USER, twoFactorRequired: true, twoFactorVerified: true } });
    expect((await createMemberGiveSessionAction("alder-creek", giveForm())).kind).toBe("checkout");
  });

  it.each([
    ["forbidden", { kind: "forbidden", name: "Alder Creek", organizationType: "congregation" }],
    ["ended", { kind: "ended", name: "Alder Creek", endedOn: "2025-01-01" }],
    ["not-found", { kind: "not-found" }],
  ])("a %s organization resolution is the one `unavailable`", async (_name, resolution) => {
    mockResolve.mockResolvedValue(resolution);
    expect(await createMemberGiveSessionAction("alder-creek", giveForm())).toEqual({ kind: "unavailable" });
    expect(mockToggle).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it.each(["toggle_off", "not_applicable"])("%s is `unavailable` and spends no budget", async (state) => {
    mockToggle.mockResolvedValue(state);
    expect(await createMemberGiveSessionAction("alder-creek", giveForm())).toEqual({ kind: "unavailable" });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("a membership that ended between resolve and the toggle read is `unavailable`; a database blip is `error`, never a silent `off`", async () => {
    mockToggle.mockRejectedValueOnce(new FakeOrgAccessError("ended"));
    expect(await createMemberGiveSessionAction("alder-creek", giveForm())).toEqual({ kind: "unavailable" });
    mockToggle.mockRejectedValueOnce(new Error("db down"));
    expect(await createMemberGiveSessionAction("alder-creek", giveForm())).toEqual({ kind: "error" });
  });

  it("asks for the TOGGLE only: no giving key is read (a plain member may give)", async () => {
    await createMemberGiveSessionAction("alder-creek", giveForm());
    expect(mockToggle).toHaveBeenCalledTimes(1);
    expect(mockToggle).toHaveBeenCalledWith({ personId: PERSON, organizationId: ORG, organizationType: "congregation" });
    const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("./actions.ts", import.meta.url), "utf8"));
    expect(source).not.toMatch(/hasPermission|presby_has_permission|loadGivingContext|GIVING_KEYS|giving\.(view|record|manage)/);
  });

  it("a user with no ACTIVE membership at the organization is `unavailable`", async () => {
    mockUserOrgs.mockResolvedValue([{ ...membershipRow, endedOn: "2025-01-01" }, { ...membershipRow, organizationId: "other-org" }]);
    expect(await createMemberGiveSessionAction("alder-creek", giveForm())).toEqual({ kind: "unavailable" });
    expect(mockRateLimit).not.toHaveBeenCalled();
  });
});

describe("membership_id is the viewer's own, never the form's", () => {
  it("passes the resolved membership to the database and ignores membershipId / organizationId / donorId in the form", async () => {
    await createMemberGiveSessionAction(
      "alder-creek",
      giveForm({
        membershipId: "99999999-aaaa-4aaa-8aaa-000000000009",
        organizationId: "99999999-aaaa-4aaa-8aaa-00000000000a",
        donorId: "99999999-aaaa-4aaa-8aaa-00000000000b",
        amount: "37.50",
      }),
    );
    const create = mockExecute.mock.calls.find(([q]) => sqlText(q).includes("create_intent_member"))![0];
    expect(sqlParams(create)).toEqual([MEMBERSHIP, FUND, 3750, false, "card", "once", KEY]);
    expect(mockWithOrgContext).toHaveBeenCalledWith(PERSON, ORG, expect.any(Function));
  });

  it("picks the membership at THIS organization when the user belongs to several", async () => {
    mockUserOrgs.mockResolvedValue([
      { organizationId: "other-org", personId: "other-person", membershipId: "55555555-aaaa-4aaa-8aaa-000000000005", endedOn: null },
      membershipRow,
    ]);
    await createMemberGiveSessionAction("alder-creek", giveForm());
    const create = mockExecute.mock.calls.find(([q]) => sqlText(q).includes("create_intent_member"))![0];
    expect(sqlParams(create)[0]).toBe(MEMBERSHIP);
  });
});

describe("rate limiting by user", () => {
  it("keys on the user id (10 per 10 minutes) and the shared platform key; no per-site key, no Turnstile", async () => {
    await createMemberGiveSessionAction("alder-creek", giveForm());
    expect(mockRateLimit.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [`giving_session_user:${USER}`, { max: 10, windowSeconds: 600 }],
      ["giving_session_global", { max: 2000, windowSeconds: 3600 }],
    ]);
    expect(mockRateLimit.mock.calls[0]![2]).toMatchObject({ userId: USER });
  });

  it("a refusal answers rate_limited with its wait and the database is not touched", async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 120 });
    expect(await createMemberGiveSessionAction("alder-creek", giveForm())).toEqual({ kind: "rate_limited", retryAfterSeconds: 120 });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe("the rest of the GiveResult arms", () => {
  // regression for the amount-tampering row of the adversarial table
  it.each(["10.999", "1e3", "-5", "٣٠"])("amount %j is `invalid` on the amount field", async (amount) => {
    expect(await createMemberGiveSessionAction("alder-creek", giveForm({ amount }))).toMatchObject({ kind: "invalid", field: "amount" });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("success and cancel return to the MEMBER pages on the configured origin", async () => {
    await createMemberGiveSessionAction("alder-creek", giveForm());
    const input = mockCreateSession.mock.calls[0]![0];
    expect(input.successUrl).toBe("https://app.example.invalid/o/alder-creek/giving/give/return?session_id={CHECKOUT_SESSION_ID}");
    expect(input.cancelUrl).toBe("https://app.example.invalid/o/alder-creek/giving/give");
  });

  it("unavailable when Stripe is unset (a failed intent is recorded); already_started on a repeat key; error on a Stripe failure", async () => {
    mockConfigured.mockReturnValue(false);
    expect(await createMemberGiveSessionAction("alder-creek", giveForm())).toEqual({ kind: "unavailable" });
    expect(mockExecute.mock.calls.some(([q]) => sqlText(q).includes("fail_intent"))).toBe(true);

    mockConfigured.mockReturnValue(true);
    intentRow = { ...intentRow, outcome: "existing", methods: null, already_attached: true };
    expect(await createMemberGiveSessionAction("alder-creek", giveForm())).toEqual({ kind: "already_started" });

    intentRow = { ...intentRow, outcome: "created", already_attached: false, methods: ["card"] };
    mockCreateSession.mockRejectedValue(new Error("nope"));
    expect(await createMemberGiveSessionAction("alder-creek", giveForm())).toEqual({ kind: "error" });
  });

  it("a non-slug is `unavailable` before the session is read", async () => {
    expect(await createMemberGiveSessionAction("Not A Slug", giveForm())).toEqual({ kind: "unavailable" });
    expect(mockAuth).not.toHaveBeenCalled();
  });
});
