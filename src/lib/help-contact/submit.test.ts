/**
 * submitHelpContact: the order of checks (CA2) asserted by call sequence, with the
 * limiter, Turnstile, the database and notify faked. The definer itself is proven
 * by src/lib/db/domain/help-contact.db.test.ts.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const calls: string[] = [];
const execute = vi.fn();
const consume = vi.fn();
const record = vi.fn();
const turnstile = vi.fn();
const notify = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    execute: (...a: unknown[]) => {
      calls.push("definer");
      return execute(...a);
    },
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: (key: string, limit: unknown) => {
    calls.push(`consume:${key}`);
    return consume(key, limit);
  },
  recordRateLimitBlock: (...a: unknown[]) => {
    calls.push("record");
    return record(...a);
  },
}));
vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: (...a: unknown[]) => {
    calls.push("turnstile");
    return turnstile(...a);
  },
}));
vi.mock("./notify", () => ({
  notifyOperatorsOfContactMessage: (...a: unknown[]) => {
    calls.push("notify");
    return notify(...a);
  },
}));

import { submitHelpContact, usableIp } from "./submit";

const TYPED = {
  topic: "signing_in",
  name: "Marker Name Q7",
  email: "marker.q7@example.invalid",
  congregation: "Marker Congregation Q7",
  message: "Marker message Q7: I cannot sign in at all.",
};

function form(overrides: Record<string, string | undefined> = {}): FormData {
  const f = new FormData();
  const all: Record<string, string | undefined> = { ...TYPED, turnstileToken: "token-1", ...overrides };
  for (const [k, v] of Object.entries(all)) if (v !== undefined) f.set(k, v);
  return f;
}
const hdrs = (h: Record<string, string> = {}) => new Headers({ host: "localhost:3000", ...h });
const definerReturns = (outcome: string) => execute.mockResolvedValue({ rows: [{ outcome }] });

let logSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  calls.length = 0;
  execute.mockReset();
  consume.mockReset().mockResolvedValue({ allowed: true });
  record.mockReset();
  turnstile.mockReset().mockResolvedValue(true);
  notify.mockReset().mockResolvedValue({ queued: 1 });
  definerReturns("stored");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "dev-secret");
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "dev-site");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("TRUST_PROXY_HEADERS", "");
  logSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  logSpies.forEach((s) => s.mockRestore());
});

const loggedText = () =>
  logSpies.flatMap((s) => s.mock.calls).map((args) => JSON.stringify(args)).join("\n");

describe("step 1: the platform host (CA7)", () => {
  it("a church's custom host is unavailable before anything is spent", async () => {
    expect(await submitHelpContact(form(), hdrs({ host: "church-one.invalid" }))).toEqual({ kind: "unavailable" });
    expect(calls).toEqual([]);
  });
  it("a missing Host is unavailable", async () => {
    expect(await submitHelpContact(form(), new Headers())).toEqual({ kind: "unavailable" });
    expect(calls).toEqual([]);
  });
  it("an IP-literal Host in a production deployment is unavailable", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await submitHelpContact(form(), hdrs({ host: "203.0.113.9" }))).toEqual({ kind: "unavailable" });
    expect(calls).toEqual([]);
  });
  it("a forwarded action is unavailable even when its Host is a platform host (DECISION-313 regression: the CA7 defect)", async () => {
    // What Next's forwarder sends for an action that arrived on a church's own host: the server's own Host,
    // the client's host only in x-forwarded-host, and the marker.
    const h = hdrs({ host: "localhost:3000", "x-forwarded-host": "church-one.invalid", "x-action-forwarded": "1" });
    expect(await submitHelpContact(form(), h)).toEqual({ kind: "unavailable" });
    expect(calls).toEqual([]);
  });
  it("a forwarded host header decides nothing: only Host does", async () => {
    const h = hdrs({ host: "church-one.invalid", "x-forwarded-host": "localhost" });
    expect(await submitHelpContact(form(), h)).toEqual({ kind: "unavailable" });
  });
  it("localhost is the platform in development", async () => {
    expect(await submitHelpContact(form(), hdrs())).toEqual({ kind: "sent" });
  });
});

describe("step 2: configured (CA6)", () => {
  it("is unavailable when the Turnstile secret is unset, and spends nothing", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(await submitHelpContact(form(), hdrs())).toEqual({ kind: "unavailable" });
    expect(calls).toEqual([]);
  });
  it("is unavailable in a production deployment without Upstash, and sent with it (so the host was not the reason)", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://localhost");
    vi.stubEnv("NEXT_PUBLIC_PLATFORM_HOSTS", "localhost");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token-placeholder");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://upstash.example.invalid");
    expect(await submitHelpContact(form(), hdrs({ host: "localhost" }))).toEqual({ kind: "sent" });
    calls.length = 0;
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    expect(await submitHelpContact(form(), hdrs({ host: "localhost" }))).toEqual({ kind: "unavailable" });
    expect(calls).toEqual([]);
  });
});

describe("step 3: the honeypot", () => {
  it("returns the same sent and spends nothing: no limiter, no Turnstile, no database", async () => {
    expect(await submitHelpContact(form({ _hp: "http://spam.example.invalid" }), hdrs())).toEqual({ kind: "sent" });
    expect(calls).toEqual([]);
  });
  it("a blank or whitespace honeypot is a person", async () => {
    expect(await submitHelpContact(form({ _hp: "   " }), hdrs())).toEqual({ kind: "sent" });
    expect(calls).toContain("definer");
  });
});

describe("step 4: validation runs before Turnstile (the token is not burned)", () => {
  it("an invalid submission returns the field errors and never calls Turnstile, a limiter or the database", async () => {
    const out = await submitHelpContact(form({ email: "nope", message: "short" }), hdrs({ "x-real-ip": "198.51.100.7" }));
    expect(out).toEqual({ kind: "invalid", fieldErrors: { email: "bad_format", message: "too_short" } });
    expect(calls).toEqual([]);
    expect(turnstile).not.toHaveBeenCalled();
  });
  it("a non-FormData argument (a crafted call) is not sent and spends nothing", async () => {
    expect(await submitHelpContact("not a form" as unknown as FormData, hdrs())).toEqual({ kind: "not_sent" });
    expect(calls).toEqual([]);
  });
});

describe("the order of the happy path (CA2 steps 5 to 8)", () => {
  it("per-IP, then Turnstile, then the global hour and day, then the definer", async () => {
    const out = await submitHelpContact(form(), hdrs({ "x-real-ip": "198.51.100.7" }));
    expect(out).toEqual({ kind: "sent" });
    expect(calls).toEqual([
      "consume:help_contact:ip:198.51.100.7",
      "turnstile",
      "consume:help_contact:global:3600",
      "consume:help_contact:global:86400",
      "definer",
    ]);
    expect(consume).toHaveBeenNthCalledWith(1, "help_contact:ip:198.51.100.7", { max: 3, windowSeconds: 3600 });
    expect(consume).toHaveBeenNthCalledWith(2, "help_contact:global:3600", { max: 30, windowSeconds: 3600 });
    expect(consume).toHaveBeenNthCalledWith(3, "help_contact:global:86400", { max: 100, windowSeconds: 86400 });
  });
  it("hands the typed values to the definer as bound parameters, cleaned", async () => {
    await submitHelpContact(form({ message: "  Marker message Q7 \u0000with a NUL.  " }), hdrs());
    const query = execute.mock.calls[0]![0] as { queryChunks: unknown[] };
    const flat = JSON.stringify(query.queryChunks);
    expect(flat).toContain("presby_submit_help_contact");
    expect(flat).toContain("Marker message Q7 with a NUL.");
    expect(flat).not.toContain("\\u0000");
    for (const typed of [TYPED.name, TYPED.email, TYPED.congregation]) expect(flat).toContain(typed);
  });
  it("passes the Turnstile token and the usable IP to verification", async () => {
    await submitHelpContact(form({ turnstileToken: "abc" }), hdrs({ "x-real-ip": "198.51.100.7" }));
    expect(turnstile).toHaveBeenCalledWith("abc", "198.51.100.7");
  });
  it("a missing token is passed as null (verifyTurnstile refuses a configured form with none)", async () => {
    await submitHelpContact(form({ turnstileToken: undefined }), hdrs());
    expect(turnstile).toHaveBeenCalledWith(null, null);
  });
});

describe("the IP rule (CA8, AF-2)", () => {
  it("with no IP the per-IP check is skipped and no shared 'unknown' key exists", async () => {
    await submitHelpContact(form(), hdrs());
    expect(calls.filter((c) => c.startsWith("consume:")).join()).not.toMatch(/ip|unknown/);
    expect(calls).toEqual(["turnstile", "consume:help_contact:global:3600", "consume:help_contact:global:86400", "definer"]);
  });
  it("a header value that is not IP-shaped counts as no IP, so a client cannot choose a key", async () => {
    await submitHelpContact(form(), hdrs({ "cf-connecting-ip": "cf-probe-1; drop table" }));
    expect(calls.some((c) => c.includes("cf-probe"))).toBe(false);
    expect(calls.some((c) => c.startsWith("consume:help_contact:ip:"))).toBe(false);
  });
  it("usableIp accepts IPv4, IPv6 and mapped forms, and nothing else", () => {
    for (const ok of ["198.51.100.7", "2001:db8::1", "::ffff:198.51.100.7", "::1"]) expect(usableIp(ok), ok).toBe(ok);
    for (const bad of [null, "", "x", "unknown", "1.2.3.4, 5.6.7.8", "198.51.100.7 ", "a".repeat(46), "marker.q7@example.invalid"]) {
      expect(usableIp(bad), String(bad)).toBeNull();
    }
  });
  it("the key's IP part never contains typed text", async () => {
    await submitHelpContact(form(), hdrs({ "x-real-ip": "198.51.100.7" }));
    for (const call of calls) for (const typed of Object.values(TYPED)) expect(call).not.toContain(typed);
  });
});

describe("refusals", () => {
  it("per-IP refusal: busy, one bounded audit write, and Turnstile and the global ceiling are not consumed", async () => {
    consume.mockImplementation(async (key: string) =>
      key.startsWith("help_contact:ip:") ? { allowed: false, retryAfterSeconds: 120 } : { allowed: true },
    );
    expect(await submitHelpContact(form(), hdrs({ "x-real-ip": "198.51.100.7" }))).toEqual({ kind: "busy" });
    expect(calls).toEqual(["consume:help_contact:ip:198.51.100.7", "consume:help_contact:audit:ip", "record"]);
    expect(record).toHaveBeenCalledWith(
      "help_contact:ip",
      { userId: null, actor: "anonymous", reason: "help_contact_form" },
      120,
    );
  });
  it("the audit gate is a limiter of one per hour, and a closed gate writes nothing", async () => {
    consume.mockImplementation(async (key: string) =>
      key.startsWith("help_contact:audit:") ? { allowed: false, retryAfterSeconds: 10 } : { allowed: false, retryAfterSeconds: 120 },
    );
    expect(await submitHelpContact(form(), hdrs({ "x-real-ip": "198.51.100.7" }))).toEqual({ kind: "busy" });
    expect(record).not.toHaveBeenCalled();
    const gateCall = consume.mock.calls.find(([k]) => k === "help_contact:audit:ip");
    expect(gateCall![1]).toEqual({ max: 1, windowSeconds: 3600 });
  });
  it("no audit key carries an IP or typed text", async () => {
    consume.mockResolvedValue({ allowed: false, retryAfterSeconds: 5 });
    await submitHelpContact(form(), hdrs({ "x-real-ip": "198.51.100.7" }));
    const auditKeys = [...consume.mock.calls.map(([k]) => k as string), ...record.mock.calls.map(([k]) => k as string)].filter((k) =>
      /audit|^help_contact:(ip|global|ceiling)$/.test(k),
    );
    expect(auditKeys.length).toBeGreaterThan(0);
    for (const k of auditKeys) {
      expect(k).not.toContain("198.51.100.7");
      for (const typed of Object.values(TYPED)) expect(k).not.toContain(typed);
    }
  });
  it("Turnstile refusal: check_failed, and the global ceiling is not consumed", async () => {
    turnstile.mockResolvedValue(false);
    expect(await submitHelpContact(form(), hdrs())).toEqual({ kind: "check_failed" });
    expect(calls).toEqual(["turnstile"]);
  });
  it("global hour refusal: busy with one audit write, and the definer is never called", async () => {
    consume.mockImplementation(async (key: string) =>
      key === "help_contact:global:3600" ? { allowed: false, retryAfterSeconds: 900 } : { allowed: true },
    );
    expect(await submitHelpContact(form(), hdrs())).toEqual({ kind: "busy" });
    expect(calls).toEqual(["turnstile", "consume:help_contact:global:3600", "consume:help_contact:audit:global", "record"]);
    expect(execute).not.toHaveBeenCalled();
  });
  it("global day refusal is busy too", async () => {
    consume.mockImplementation(async (key: string) =>
      key === "help_contact:global:86400" ? { allowed: false, retryAfterSeconds: 9000 } : { allowed: true },
    );
    expect(await submitHelpContact(form(), hdrs())).toEqual({ kind: "busy" });
    expect(execute).not.toHaveBeenCalled();
  });
  it("the database ceiling: busy, one audit write of kind 'ceiling'", async () => {
    definerReturns("ceiling");
    expect(await submitHelpContact(form(), hdrs())).toEqual({ kind: "busy" });
    expect(record).toHaveBeenCalledWith("help_contact:ceiling", expect.any(Object), expect.any(Number));
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("the definer's tokens", () => {
  it("'stored' is sent and does not notify", async () => {
    definerReturns("stored");
    expect(await submitHelpContact(form(), hdrs())).toEqual({ kind: "sent" });
    expect(notify).not.toHaveBeenCalled();
  });
  it("'stored_notify' notifies, then is sent", async () => {
    definerReturns("stored_notify");
    expect(await submitHelpContact(form(), hdrs())).toEqual({ kind: "sent" });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(calls.slice(-2)).toEqual(["definer", "notify"]);
  });
  it("notify takes no argument, so the typed text cannot reach it (C5)", async () => {
    definerReturns("stored_notify");
    await submitHelpContact(form(), hdrs());
    expect(notify.mock.calls[0]).toEqual([]);
  });
  it("a notify that throws does not fail the submission", async () => {
    definerReturns("stored_notify");
    notify.mockRejectedValue(new Error("resend down"));
    // notify.ts swallows its own failures; this guards a future change that lets one escape
    expect(await submitHelpContact(form(), hdrs())).toEqual({ kind: "sent" });
  });
  it("an unknown token or no row is not_sent", async () => {
    definerReturns("surprise");
    expect(await submitHelpContact(form(), hdrs())).toEqual({ kind: "not_sent" });
    execute.mockResolvedValue({ rows: [] });
    expect(await submitHelpContact(form(), hdrs())).toEqual({ kind: "not_sent" });
  });
});

describe("errors", () => {
  it("SQLSTATE 42501 (EXECUTE revoked, lever A) is unavailable, including through Drizzle's .cause wrapper", async () => {
    execute.mockRejectedValue(Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("permission denied for function"), { code: "42501" }) }));
    expect(await submitHelpContact(form(), hdrs())).toEqual({ kind: "unavailable" });
  });
  it("another database error is not_sent, and the log names the class and SQLSTATE only", async () => {
    execute.mockRejectedValue(Object.assign(new Error(`violates check constraint for ${TYPED.message}`), { code: "23514" }));
    expect(await submitHelpContact(form(), hdrs())).toEqual({ kind: "not_sent" });
    const text = loggedText();
    expect(text).toContain("23514");
    for (const typed of Object.values(TYPED)) expect(text).not.toContain(typed);
    expect(text).not.toContain("violates check constraint");
  });
  it("an Upstash throw fails closed as not_sent, before Turnstile for the per-IP step", async () => {
    consume.mockRejectedValue(new Error("upstash down"));
    expect(await submitHelpContact(form(), hdrs({ "x-real-ip": "198.51.100.7" }))).toEqual({ kind: "not_sent" });
    expect(execute).not.toHaveBeenCalled();
  });
  it("an Upstash throw at the global ceiling is not_sent and nothing is stored", async () => {
    consume.mockImplementation(async (key: string) => {
      if (key.startsWith("help_contact:global")) throw new Error("upstash down");
      return { allowed: true };
    });
    expect(await submitHelpContact(form(), hdrs())).toEqual({ kind: "not_sent" });
    expect(execute).not.toHaveBeenCalled();
  });
  it("console is never called with anything the visitor typed, on any path", async () => {
    definerReturns("stored_notify");
    await submitHelpContact(form(), hdrs());
    execute.mockRejectedValue(new Error(TYPED.message));
    await submitHelpContact(form(), hdrs());
    consume.mockRejectedValue(new Error(TYPED.email));
    await submitHelpContact(form(), hdrs({ "x-real-ip": "198.51.100.7" }));
    const text = loggedText();
    for (const typed of Object.values(TYPED)) expect(text).not.toContain(typed);
  });
});

describe("source", () => {
  it("never reads a session or the typed text into a key", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./submit.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/\bauth\(/);
    expect(src).not.toMatch(/@\/auth|getPlatformDb|next\/headers/);
  });
});
