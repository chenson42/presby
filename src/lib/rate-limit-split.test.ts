/**
 * DECISION-302: `consumeRateLimit` (the check, no audit) and
 * `recordRateLimitBlock` (the audit write) are the two halves `checkRateLimit`
 * composes. The existing rate-limit.test.ts passes unedited and is the guard for
 * `checkRateLimit`'s unchanged behaviour; this file pins the halves.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const valuesSpy = vi.fn();
const insertSpy = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    insert: (...args: unknown[]) => {
      insertSpy(...args);
      return {
        values: (row: unknown) => {
          valuesSpy(row);
          return { catch: vi.fn() };
        },
      };
    },
  },
}));
vi.mock("@/lib/audit", () => ({ AUDIT_ACTIONS: { RATE_LIMIT_BLOCKED: "rate_limit.blocked" } }));
vi.mock("@/lib/db/schema", () => ({ auditEvents: {} }));

import { checkRateLimit, consumeRateLimit, recordRateLimitBlock, _inMemoryStore } from "./rate-limit";

const key = () => `split:${Math.random().toString(36).slice(2)}`;

beforeEach(() => {
  _inMemoryStore.clear();
  insertSpy.mockClear();
  valuesSpy.mockClear();
  vi.stubEnv("RATE_LIMIT_DISABLED", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("consumeRateLimit", () => {
  it("allows up to max and refuses the next, and never touches the database", async () => {
    const k = key();
    for (let i = 0; i < 2; i += 1) {
      expect(await consumeRateLimit(k, { max: 2, windowSeconds: 60 })).toEqual({ allowed: true });
    }
    const refused = await consumeRateLimit(k, { max: 2, windowSeconds: 60 });
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("honours RATE_LIMIT_DISABLED", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "true");
    const k = key();
    for (let i = 0; i < 5; i += 1) {
      expect(await consumeRateLimit(k, { max: 1, windowSeconds: 60 })).toEqual({ allowed: true });
    }
  });
});

describe("recordRateLimitBlock", () => {
  it("writes one rate_limit.blocked row with the existing metadata shape and no ip column", () => {
    recordRateLimitBlock("help_contact:ip", { userId: null, actor: "anonymous", reason: "help_contact_form" }, 42);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(valuesSpy).toHaveBeenCalledWith({
      actorUserId: null,
      actorEmail: null,
      action: "rate_limit.blocked",
      resourceType: "rate_limit",
      resourceId: "help_contact:ip",
      metadata: { reason: "help_contact_form", actor: "anonymous", retryAfterSeconds: 42 },
    });
    expect(Object.keys(valuesSpy.mock.calls[0][0] as object)).not.toContain("ip");
  });

  it("keeps an email-shaped actor in actorEmail, as checkRateLimit always did", () => {
    recordRateLimitBlock("k", { userId: "u1", actor: "x@example.invalid", reason: "r" }, 1);
    expect(valuesSpy.mock.calls[0][0]).toMatchObject({ actorUserId: "u1", actorEmail: "x@example.invalid" });
  });
});

describe("checkRateLimit is their composition", () => {
  it("audits exactly the refused call, with the same row shape", async () => {
    const k = key();
    expect(await checkRateLimit(k, { max: 1, windowSeconds: 60 }, { actor: "a", reason: "r" })).toEqual({ allowed: true });
    expect(insertSpy).not.toHaveBeenCalled();
    const refused = await checkRateLimit(k, { max: 1, windowSeconds: 60 }, { actor: "a", reason: "r" });
    expect(refused.allowed).toBe(false);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(valuesSpy.mock.calls[0][0]).toMatchObject({ resourceId: k, metadata: { reason: "r", actor: "a" } });
  });
});
