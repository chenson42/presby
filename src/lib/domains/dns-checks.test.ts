/**
 * The routing checks on the fake DNS quorum. No network.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createFakeDns } from "./adapters/fake";
import {
  checkCaa,
  checkRouting,
  GENERIC_HOSTING_TARGETS,
  lookupNsFingerprint,
  parseCaaData,
  type RoutingTargets,
} from "./dns-checks";

const TARGETS: RoutingTargets = { cname: "cname-a.vercel-dns.invalid", ipv4: ["192.0.2.10", "192.0.2.11"] };
const APEX = "church-one.invalid";
const WWW = `www.${APEX}`;
const CF_IP = "104.16.1.1"; // inside Cloudflare's published edge range

describe("checkRouting", () => {
  it("an apex whose A records are all the provider's is correct, and the SOA marks it a zone apex", async () => {
    const d = createFakeDns();
    d.setRecord("A", APEX, "192.0.2.10", "192.0.2.11");
    d.setRecord("SOA", APEX, "ns1.invalid hostmaster.invalid 1 7200 3600 1209600 300");
    expect(await checkRouting(d.observer, APEX, TARGETS, { diagnose: true })).toEqual({
      hostname: APEX,
      status: "correct",
      hint: null,
      apex: true,
      pointsAtProvider: true,
    });
  });

  it("a www host CNAMEd to the provider's target is correct, and is never an apex (no SOA query is made)", async () => {
    const d = createFakeDns();
    d.setRecord("CNAME", WWW, "cname-a.vercel-dns.invalid");
    const r = await checkRouting(d.observer, WWW, TARGETS, { diagnose: false });
    expect(r).toMatchObject({ status: "correct", apex: false, pointsAtProvider: true });
    expect(d.cloudflare.calls.some((c) => c.type === "SOA")).toBe(false);
  });

  it("a trailing dot and upper case in the CNAME still match", async () => {
    const d = createFakeDns();
    d.setRecord("CNAME", WWW, "CNAME-A.vercel-dns.invalid.");
    expect(await checkRouting(d.observer, WWW, TARGETS, { diagnose: false })).toMatchObject({ status: "correct" });
  });

  it("the provider's long-standing generic targets are accepted too (a church whose records are generic needs no change)", async () => {
    const d = createFakeDns();
    d.setRecord("A", APEX, GENERIC_HOSTING_TARGETS.ipv4[0]!);
    expect(await checkRouting(d.observer, APEX, TARGETS, { diagnose: false })).toMatchObject({ status: "correct" });
    const e = createFakeDns();
    e.setRecord("CNAME", WWW, GENERIC_HOSTING_TARGETS.cname!);
    expect(await checkRouting(e.observer, WWW, TARGETS, { diagnose: false })).toMatchObject({ status: "correct" });
  });

  it("with no recommendation known at all, the generic targets are the yardstick", async () => {
    const d = createFakeDns();
    d.setRecord("A", APEX, GENERIC_HOSTING_TARGETS.ipv4[0]!);
    expect(await checkRouting(d.observer, APEX, null, { diagnose: false })).toMatchObject({ status: "correct" });
  });

  it("both resolvers saying 'no A, no CNAME' is missing (and not pointing at the provider)", async () => {
    const d = createFakeDns();
    expect(await checkRouting(d.observer, APEX, TARGETS, { diagnose: false })).toMatchObject({
      status: "missing",
      pointsAtProvider: false,
    });
  });

  it("a resolver error is UNKNOWN, never 'missing'", async () => {
    const d = createFakeDns();
    d.google.failWith("timeout");
    expect(await checkRouting(d.observer, APEX, TARGETS, { diagnose: false })).toMatchObject({
      status: "unknown",
      pointsAtProvider: null,
    });
  });

  it("A records pointing somewhere else are wrong_value", async () => {
    const d = createFakeDns();
    d.setRecord("A", APEX, "198.51.100.7");
    expect(await checkRouting(d.observer, APEX, TARGETS, { diagnose: false })).toMatchObject({
      status: "wrong_value",
      hint: null,
      pointsAtProvider: false,
    });
  });

  it("a CNAME to somewhere else is wrong_value", async () => {
    const d = createFakeDns();
    d.setRecord("CNAME", WWW, "old-host.invalid");
    expect(await checkRouting(d.observer, WWW, TARGETS, { diagnose: false })).toMatchObject({
      status: "wrong_value",
      pointsAtProvider: false,
    });
  });

  it("A records inside Cloudflare's edge are the 'proxied' mistake: wrong_value with the proxied hint", async () => {
    const d = createFakeDns();
    d.setRecord("A", APEX, CF_IP, "104.16.1.2");
    expect(await checkRouting(d.observer, APEX, TARGETS, { diagnose: false })).toMatchObject({
      status: "wrong_value",
      hint: "proxied",
      pointsAtProvider: false,
    });
  });

  it("A records split between the provider and elsewhere are conflicting", async () => {
    const d = createFakeDns();
    d.setRecord("A", APEX, "192.0.2.10", "198.51.100.7");
    expect(await checkRouting(d.observer, APEX, TARGETS, { diagnose: false })).toMatchObject({
      status: "conflicting",
      pointsAtProvider: true,
    });
  });

  it("a LEFTOVER AAAA turns an otherwise correct host into conflicting (it silently sends IPv6 visitors to the old host)", async () => {
    const d = createFakeDns();
    d.setRecord("A", APEX, "192.0.2.10");
    d.setRecord("AAAA", APEX, "2001:db8::1");
    expect(await checkRouting(d.observer, APEX, TARGETS, { diagnose: false })).toMatchObject({
      status: "conflicting",
      hint: "leftover_aaaa",
      pointsAtProvider: true,
    });
  });

  it("an AAAA beside a wrong A keeps wrong_value but adds the hint when it has none", async () => {
    const d = createFakeDns();
    d.setRecord("A", APEX, "198.51.100.7");
    d.setRecord("AAAA", APEX, "2001:db8::1");
    expect(await checkRouting(d.observer, APEX, TARGETS, { diagnose: false })).toMatchObject({
      status: "wrong_value",
      hint: "leftover_aaaa",
    });
  });

  it("proxied outranks leftover_aaaa as the hint", async () => {
    const d = createFakeDns();
    d.setRecord("A", APEX, CF_IP);
    d.setRecord("AAAA", APEX, "2606:4700::1");
    expect(await checkRouting(d.observer, APEX, TARGETS, { diagnose: false })).toMatchObject({ hint: "proxied" });
  });

  describe("CAA (only when diagnosing a host that is waiting for its certificate)", () => {
    it("a CAA record that does not authorize the provider's CA blocks issuance: conflicting + caa", async () => {
      const d = createFakeDns();
      d.setRecord("A", APEX, "192.0.2.10");
      d.setRecord("CAA", APEX, '0 issue "other-ca.invalid"');
      expect(await checkRouting(d.observer, APEX, TARGETS, { diagnose: true })).toMatchObject({
        status: "conflicting",
        hint: "caa",
      });
    });

    it("a CAA record that authorizes letsencrypt.org (with parameters) is fine", async () => {
      const d = createFakeDns();
      d.setRecord("A", APEX, "192.0.2.10");
      d.setRecord("CAA", APEX, '0 issue "letsencrypt.org; validationmethods=dns-01"');
      expect(await checkRouting(d.observer, APEX, TARGETS, { diagnose: true })).toMatchObject({ status: "correct", hint: null });
    });

    it("is not looked at when not diagnosing (a live host already has its certificate)", async () => {
      const d = createFakeDns();
      d.setRecord("A", APEX, "192.0.2.10");
      d.setRecord("CAA", APEX, '0 issue "other-ca.invalid"');
      expect(await checkRouting(d.observer, APEX, TARGETS, { diagnose: false })).toMatchObject({ status: "correct" });
      expect(d.cloudflare.calls.some((c) => c.type === "CAA")).toBe(false);
    });

    it("walks UP the name tree: a restrictive CAA at the apex blocks the www host", async () => {
      const d = createFakeDns();
      d.setRecord("CNAME", WWW, "cname-a.vercel-dns.invalid");
      d.setRecord("CAA", APEX, '0 issue ";"');
      expect(await checkRouting(d.observer, WWW, TARGETS, { diagnose: true })).toMatchObject({ status: "conflicting", hint: "caa" });
    });
  });

  describe("DNSSEC", () => {
    it("SERVFAIL when validated, a clean answer with checking disabled: the hint is dnssec", async () => {
      const d = createFakeDns();
      d.setRecord("A", APEX, "192.0.2.10");
      d.breakDnssec(APEX);
      expect(await checkRouting(d.observer, APEX, TARGETS, { diagnose: true })).toMatchObject({
        status: "conflicting",
        hint: "dnssec",
        pointsAtProvider: null,
      });
    });

    it("a plain outage (errors even with checking disabled) stays unknown, not dnssec", async () => {
      const d = createFakeDns();
      d.cloudflare.failWith("servfail");
      d.google.failWith("servfail");
      expect(await checkRouting(d.observer, APEX, TARGETS, { diagnose: true })).toMatchObject({ status: "unknown", hint: null });
    });

    it("a timeout is not servfail: no dnssec accusation", async () => {
      const d = createFakeDns();
      d.cloudflare.failWith("timeout");
      d.google.failWith("timeout");
      expect(await checkRouting(d.observer, APEX, TARGETS, { diagnose: true })).toMatchObject({ status: "unknown", hint: null });
    });
  });

  it("an SOA lookup that cannot answer leaves apex unknown (null), not guessed", async () => {
    const d = createFakeDns();
    d.setRecord("A", APEX, "192.0.2.10");
    d.cloudflare.failWith("timeout");
    // A is then unknown too, but the apex field must be null rather than false.
    expect((await checkRouting(d.observer, APEX, TARGETS, { diagnose: false })).apex).toBeNull();
  });
});

describe("parseCaaData", () => {
  it("reads the presentation form and the RFC 3597 generic form", () => {
    expect(parseCaaData('0 issue "letsencrypt.org"')).toEqual({ flags: 0, tag: "issue", value: "letsencrypt.org" });
    expect(parseCaaData('128 issuewild ";"')).toEqual({ flags: 128, tag: "issuewild", value: ";" });
    // 00 05 "issue" "letsencrypt.org"
    const hex = Buffer.concat([Buffer.from([0, 5]), Buffer.from("issue"), Buffer.from("letsencrypt.org")]).toString("hex");
    expect(parseCaaData(`\\# ${hex.length / 2} ${hex}`)).toEqual({ flags: 0, tag: "issue", value: "letsencrypt.org" });
  });
  it("returns null for anything it cannot read (never accuse on doubt)", () => {
    for (const bad of ["", "garbage", "\\# 4 00", "\\# 3 000", "\\# 2 0009"]) expect(parseCaaData(bad), bad).toBeNull();
  });
});

describe("checkCaa", () => {
  it("no CAA anywhere: not blocked", async () => {
    expect(await checkCaa(createFakeDns().observer, WWW)).toEqual({ blocked: false });
  });
  it("a CAA set with no issue tag restricts nothing", async () => {
    const d = createFakeDns();
    d.setRecord("CAA", APEX, '0 iodef "mailto:security@example.invalid"');
    expect(await checkCaa(d.observer, WWW)).toEqual({ blocked: false });
  });
  it("an unreadable record, or a resolver error, is null: no accusation", async () => {
    const d = createFakeDns();
    d.setRecord("CAA", APEX, "totally unparseable");
    expect(await checkCaa(d.observer, APEX)).toEqual({ blocked: null });
    const e = createFakeDns();
    e.google.failWith("timeout");
    expect(await checkCaa(e.observer, APEX)).toEqual({ blocked: null });
  });
  it("never climbs into the TLD", async () => {
    const d = createFakeDns();
    await checkCaa(d.observer, "a.b.church-one.invalid");
    const names = new Set(d.cloudflare.calls.map((c) => c.name));
    expect(names).toEqual(new Set(["a.b.church-one.invalid", "b.church-one.invalid", "church-one.invalid"]));
  });
});

describe("lookupNsFingerprint", () => {
  it("is the sorted, de-duplicated nameserver set of the closest zone at or above the name", async () => {
    const d = createFakeDns();
    d.setRecord("NS", APEX, "NS2.dns-host.invalid.", "ns1.dns-host.invalid", "ns1.dns-host.invalid.");
    expect(await lookupNsFingerprint(d.observer, APEX)).toEqual({ kind: "ok", fingerprint: "ns1.dns-host.invalid,ns2.dns-host.invalid" });
    expect(await lookupNsFingerprint(d.observer, WWW)).toEqual({ kind: "ok", fingerprint: "ns1.dns-host.invalid,ns2.dns-host.invalid" });
  });
  it("none when no zone answers, unknown when a resolver errors", async () => {
    expect(await lookupNsFingerprint(createFakeDns().observer, APEX)).toEqual({ kind: "none" });
    const d = createFakeDns();
    d.google.failWith("timeout");
    expect(await lookupNsFingerprint(d.observer, APEX)).toEqual({ kind: "unknown" });
  });
});
