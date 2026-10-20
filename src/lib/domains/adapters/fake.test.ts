/**
 * The hosting and probe fakes: they exist so the whole lifecycle can run with
 * no provider, so they must themselves be faithful to the properties the
 * lifecycle relies on (idempotent add/remove, injected failures, a call log, a
 * state file read on every call).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FakeHosting, FakeProbe, fileStateReader, type FakeState } from "./fake";

const HOST = "church-one.invalid";
const CHALLENGE = [{ type: "TXT", domain: `_vercel.${HOST}`, value: "vc-domain-verify=abc", reason: "pending_domain_verification" }];

describe("FakeHosting", () => {
  it("add is idempotent the way Vercel's is: the second add is already_on_project", async () => {
    const h = new FakeHosting();
    expect(await h.addDomain(HOST)).toEqual({ kind: "ok", verified: true, verification: [] });
    expect(await h.addDomain(HOST)).toEqual({ kind: "already_on_project" });
    expect(h.isAttached(HOST)).toBe(true);
    expect(h.callsOf("add")).toEqual([HOST, HOST]);
  });

  it("get / verify / remove behave: not_found before attach, remove is idempotent", async () => {
    const h = new FakeHosting();
    expect(await h.getDomain(HOST)).toEqual({ kind: "not_found" });
    expect(await h.verifyDomain(HOST)).toEqual({ kind: "not_found" });
    expect(await h.removeDomain(HOST)).toEqual({ kind: "ok" });
    await h.addDomain(HOST);
    expect(await h.getDomain(HOST)).toEqual({ kind: "ok", verified: true, verification: [] });
    expect(await h.removeDomain(HOST)).toEqual({ kind: "ok" });
    expect(h.isAttached(HOST)).toBe(false);
    expect(await h.removeDomain(HOST)).toEqual({ kind: "ok" });
  });

  it("a name in another account attaches UNVERIFIED with the challenge until verify succeeds", async () => {
    const h = new FakeHosting().requireChallenge(HOST, CHALLENGE);
    expect(await h.addDomain(HOST)).toEqual({ kind: "ok", verified: false, verification: CHALLENGE });
    expect(await h.getDomain(HOST)).toEqual({ kind: "ok", verified: false, verification: CHALLENGE });
    expect(await h.verifyDomain(HOST)).toEqual({ kind: "not_verified" });
  });

  it("injected failures map to the right result per operation, can be bounded, and can be cleared", async () => {
    const h = new FakeHosting();
    h.failWith("add", "rate_limited", { retryAfterSeconds: 30, times: 2 });
    expect(await h.addDomain(HOST)).toEqual({ kind: "retryable", reason: "rate_limited", retryAfterSeconds: 30 });
    expect(await h.addDomain(HOST)).toEqual({ kind: "retryable", reason: "rate_limited", retryAfterSeconds: 30 });
    expect(await h.addDomain(HOST)).toEqual({ kind: "ok", verified: true, verification: [] });

    const cases: Array<[Parameters<FakeHosting["failWith"]>[1], unknown]> = [
      ["unavailable", { kind: "retryable", reason: "unavailable", retryAfterSeconds: undefined }],
      ["deployment_not_ready", { kind: "retryable", reason: "deployment_not_ready" }],
      ["token_invalid", { kind: "config_error", reason: "token_invalid" }],
      ["payment_required", { kind: "config_error", reason: "payment_required" }],
      ["blocked_other_project", { kind: "blocked", reason: "other_project" }],
      ["blocked_no_access", { kind: "blocked", reason: "no_access" }],
      ["rejected", { kind: "rejected", reason: "unknown" }],
    ];
    for (const [failure, expected] of cases) {
      const f = new FakeHosting().failWith("add", failure);
      expect(await f.addDomain("x-" + HOST), String(failure)).toEqual(expected);
    }
    const g = new FakeHosting().failWith("remove", "unavailable");
    expect(await g.removeDomain(HOST)).toMatchObject({ kind: "retryable" });
    g.failWith("remove", null);
    expect(await g.removeDomain(HOST)).toEqual({ kind: "ok" });
    const all = new FakeHosting().failWith("all", "token_invalid");
    expect(await all.getDomain(HOST)).toEqual({ kind: "config_error", reason: "token_invalid" });
    expect(await all.removeDomain(HOST)).toEqual({ kind: "config_error", reason: "token_invalid" });
  });

  it("getConfig: defaults, a set recommendation, and 'denied' (a project token refused on the team endpoint)", async () => {
    const h = new FakeHosting();
    expect(await h.getConfig(HOST)).toMatchObject({ kind: "ok", misconfigured: false });
    h.setConfig({ recommendedCname: "cname-a.vercel-dns.invalid", recommendedIpv4: ["192.0.2.50"], misconfigured: true });
    expect(await h.getConfig(HOST)).toEqual({
      kind: "ok",
      misconfigured: true,
      recommendedCname: "cname-a.vercel-dns.invalid",
      recommendedIpv4: ["192.0.2.50"],
    });
    h.setConfig("denied");
    expect(await h.getConfig(HOST)).toEqual({ kind: "unavailable", reason: "denied" });
  });

  it("the state file is an overlay read on every call (attach a host, deny config, fail every add)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "domains-fake-"));
    const file = join(dir, "state.json");
    const write = (s: FakeState) => writeFileSync(file, JSON.stringify(s));
    try {
      const h = new FakeHosting(fileStateReader(file));
      expect(await h.getDomain(HOST)).toEqual({ kind: "not_found" });
      write({ hosting: { attached: { [HOST]: {} } } });
      expect(await h.getDomain(HOST)).toEqual({ kind: "ok", verified: true, verification: [] });
      expect(await h.addDomain(HOST)).toEqual({ kind: "already_on_project" });
      write({ hosting: { config: "denied" } });
      expect(await h.getConfig(HOST)).toEqual({ kind: "unavailable", reason: "denied" });
      write({ hosting: { config: { recommendedIpv4: ["192.0.2.77"] } } });
      expect(await h.getConfig(HOST)).toMatchObject({ kind: "ok", recommendedIpv4: ["192.0.2.77"] });
      write({ hosting: { failures: { all: "unavailable" } } });
      expect(await h.addDomain("other-" + HOST)).toMatchObject({ kind: "retryable", reason: "unavailable" });
      write({});
      expect(await h.addDomain("other-" + HOST)).toMatchObject({ kind: "ok" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("FakeProbe", () => {
  it("answers per host, falls back to unknown, logs every call, and reads the state file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "domains-fake-"));
    const file = join(dir, "state.json");
    try {
      const p = new FakeProbe(fileStateReader(file));
      expect(await p.probe(HOST)).toBe("unknown");
      p.set(HOST, "ack");
      expect(await p.probe(HOST)).toBe("ack");
      expect(await p.probe("other.invalid")).toBe("unknown");
      p.setDefault("negative");
      expect(await p.probe("other.invalid")).toBe("negative");
      writeFileSync(file, JSON.stringify({ probe: { "third.invalid": "ack" } }));
      expect(await p.probe("third.invalid")).toBe("ack");
      expect(p.calls).toEqual([HOST, HOST, "other.invalid", "other.invalid", "third.invalid"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
