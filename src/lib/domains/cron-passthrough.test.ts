import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CRON_PATHS, isCronRequest } from "./cron-passthrough";

const SECRET = "cron-secret-fixture-value";
const BEARER = `Bearer ${SECRET}`;

describe("CRON_PATHS - pinned to vercel.json", () => {
  it("is set-equal to vercel.json's crons[].path", () => {
    const file = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../../vercel.json"), "utf8"),
    ) as { crons: Array<{ path: string }> };
    expect([...CRON_PATHS].sort()).toEqual(file.crons.map((c) => c.path).sort());
  });

  it("holds exact, query-free, absolute paths", () => {
    for (const p of CRON_PATHS) expect(p).toMatch(/^\/api\/cron\/[a-z-]+$/);
  });
});

describe("isCronRequest", () => {
  it("passes every exact cron path with the exact bearer", () => {
    for (const p of CRON_PATHS) expect(isCronRequest(p, BEARER, SECRET)).toBe(true);
  });

  it("refuses when CRON_SECRET is unset, empty or not a string", () => {
    for (const secret of [undefined, null, ""]) {
      expect(isCronRequest("/api/cron/email-queue", BEARER, secret)).toBe(false);
      // The classic hole: an unset secret and a header that spells "Bearer undefined".
      expect(isCronRequest("/api/cron/email-queue", "Bearer undefined", secret)).toBe(false);
      expect(isCronRequest("/api/cron/email-queue", "Bearer ", secret)).toBe(false);
    }
  });

  it("refuses a missing, empty, wrong, wrong-length, or wrong-scheme authorization", () => {
    const p = "/api/cron/email-queue";
    expect(isCronRequest(p, null, SECRET)).toBe(false);
    expect(isCronRequest(p, undefined, SECRET)).toBe(false);
    expect(isCronRequest(p, "", SECRET)).toBe(false);
    expect(isCronRequest(p, "Bearer ", SECRET)).toBe(false);
    expect(isCronRequest(p, "Bearer wrong-secret-value-of-same-size", SECRET)).toBe(false);
    expect(isCronRequest(p, `${BEARER}x`, SECRET)).toBe(false); // longer
    expect(isCronRequest(p, BEARER.slice(0, -1), SECRET)).toBe(false); // shorter
    expect(isCronRequest(p, `bearer ${SECRET}`, SECRET)).toBe(false); // scheme case
    expect(isCronRequest(p, `Basic ${SECRET}`, SECRET)).toBe(false);
    expect(isCronRequest(p, SECRET, SECRET)).toBe(false); // no scheme at all
  });

  it("matches the exact path only: no near-miss, encoded or dot-segment variant", () => {
    const variants = [
      "/api/cron/email-queue/",
      "/api/cron/email-queue//",
      "//api/cron/email-queue",
      "/API/cron/email-queue",
      "/api/CRON/email-queue",
      "/api/cron/Email-Queue",
      "/api/cron/%65mail-queue",
      "/api/cron%2Femail-queue",
      "/api/cron/email-queue%2F",
      "/api/cron/./email-queue",
      "/api/cron/x/../email-queue",
      "/api/cron/email-queue/.",
      "/api/cron/email-queue/extra",
      "/api/cron/email-queue ",
      " /api/cron/email-queue",
      "/api/cron/email-queue?x=1",
      "/api/cron/email-queue#frag",
      "/api/cron",
      "/api/cron/",
      "/api/cron/unknown",
      "/api/auth/csrf",
      "/api/webhooks/stripe",
      "api/cron/email-queue",
      "",
    ];
    for (const v of variants) {
      expect(isCronRequest(v, BEARER, SECRET), JSON.stringify(v)).toBe(false);
    }
  });

  it("never throws on hostile input", () => {
    expect(() => isCronRequest("/api/cron/domains", "\u0000\ud800", SECRET)).not.toThrow();
    expect(() => isCronRequest("\u0000", BEARER, SECRET)).not.toThrow();
  });
});
