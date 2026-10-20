import { describe, expect, it } from "vitest";
import { ackMatches, answerProbe, makeProbe, PROBE_ACK_HEADER, PROBE_REQUEST_HEADER } from "./probe";

// leak-ok: a throwaway value used only inside this test
const SECRET = "test-auth-secret-not-real";
const HOST = "church-one.invalid";

describe("the live-ness probe handshake (T1)", () => {
  it("round-trips: the proxy's ack for a fresh probe equals the sweeper's expected ack", () => {
    const probe = makeProbe(HOST, SECRET);
    expect(answerProbe(HOST, probe.header, SECRET)).toBe(probe.expectedAck);
    expect(ackMatches(probe.expectedAck, answerProbe(HOST, probe.header, SECRET))).toBe(true);
  });

  it("the header is <32 hex nonce>.<mac> and every probe uses a fresh nonce", () => {
    const a = makeProbe(HOST, SECRET);
    const b = makeProbe(HOST, SECRET);
    expect(a.header).toMatch(/^[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
    expect(a.header).not.toBe(b.header);
    expect(a.expectedAck).not.toBe(b.expectedAck);
  });

  it("is bound to the HOST: a probe for one host gets no ack from another (a request cannot be replayed across tenants)", () => {
    const probe = makeProbe(HOST, SECRET);
    expect(answerProbe("church-two.invalid", probe.header, SECRET)).toBeNull();
    expect(answerProbe(`www.${HOST}`, probe.header, SECRET)).toBeNull();
  });

  it("the ack is bound to the NONCE: an ack observed for one probe is not the ack for the next (no replay)", () => {
    const first = makeProbe(HOST, SECRET);
    const second = makeProbe(HOST, SECRET);
    const ackForFirst = answerProbe(HOST, first.header, SECRET);
    expect(ackMatches(second.expectedAck, ackForFirst)).toBe(false);
  });

  it("the ack is not the request MAC (the two uses are domain-separated)", () => {
    const probe = makeProbe(HOST, SECRET);
    const mac = probe.header.slice(33);
    expect(mac).not.toBe(probe.expectedAck);
    expect(ackMatches(probe.expectedAck, mac)).toBe(false);
  });

  it("a different secret verifies nothing (only a deployment holding the secret can answer)", () => {
    const probe = makeProbe(HOST, SECRET);
    expect(answerProbe(HOST, probe.header, "another-secret")).toBeNull();
  });

  it("rejects a tampered MAC, a tampered nonce, and every malformed header without throwing", () => {
    const probe = makeProbe(HOST, SECRET);
    const [nonce, mac] = probe.header.split(".") as [string, string];
    const flipped = mac.slice(0, -1) + (mac.endsWith("A") ? "B" : "A");
    const cases: Array<string | null | undefined> = [
      `${nonce}.${flipped}`,
      `${"0".repeat(32)}.${mac}`,
      `${nonce}.`,
      `.${mac}`,
      nonce,
      `${nonce}${mac}`,
      `${nonce.toUpperCase()}.${mac}`,
      `${nonce}.${mac}.extra`,
      `${nonce.slice(0, 31)}.${mac}`,
      "",
      " ",
      "undefined",
      "\u0000".repeat(40),
      "x".repeat(10_000),
      null,
      undefined,
    ];
    for (const value of cases) expect(answerProbe(HOST, value, SECRET), String(value)).toBeNull();
  });

  it("makeProbe throws without a secret (a guessable key would be a forgeable 'live'); answerProbe returns null", () => {
    // `undefined` falls through to process.env.AUTH_SECRET by design, so make the environment empty too.
    const prior = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    try {
      expect(() => makeProbe(HOST, undefined)).toThrow(/AUTH_SECRET/);
      expect(() => makeProbe(HOST, "")).toThrow(/AUTH_SECRET/);
      const probe = makeProbe(HOST, SECRET);
      expect(answerProbe(HOST, probe.header, undefined)).toBeNull();
      expect(answerProbe(HOST, probe.header, "")).toBeNull();
    } finally {
      if (prior !== undefined) process.env.AUTH_SECRET = prior;
    }
  });

  it("host and nonce cannot be shifted across the field boundary (unambiguous encoding)", () => {
    const a = makeProbe("a.invalid", SECRET);
    // Same nonce+mac against hosts that would concatenate to the same bytes.
    expect(answerProbe("a.invali", a.header, SECRET)).toBeNull();
    expect(answerProbe("a.invalid\n", a.header, SECRET)).toBeNull();
  });

  it("ackMatches is false for null, undefined, the empty string and a length mismatch", () => {
    expect(ackMatches("abc", null)).toBe(false);
    expect(ackMatches("abc", undefined)).toBe(false);
    expect(ackMatches("abc", "")).toBe(false);
    expect(ackMatches("abc", "abcd")).toBe(false);
    expect(ackMatches("abc", "abc")).toBe(true);
  });

  it("reads AUTH_SECRET from the environment by default", () => {
    const prior = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = SECRET;
    try {
      const probe = makeProbe(HOST);
      expect(answerProbe(HOST, probe.header)).toBe(probe.expectedAck);
    } finally {
      if (prior === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prior;
    }
  });

  it("exports the two header names the proxy and the sweeper share", () => {
    expect(PROBE_REQUEST_HEADER).toBe("x-presby-probe");
    expect(PROBE_ACK_HEADER).toBe("x-presby-probe-ack");
  });
});
