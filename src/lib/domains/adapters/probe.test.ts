/**
 * The sweeper's side of the live-ness probe. `fetch` is a stub and DNS is the
 * fake quorum: nothing leaves the process.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { answerProbe, PROBE_ACK_HEADER, PROBE_REQUEST_HEADER } from "../probe";
import { createFakeDns } from "./fake";
import { HttpsProbe } from "./probe";

// leak-ok: a throwaway value used only inside this test
const SECRET = "test-auth-secret-not-real";
const HOST = "church-one.invalid";

function setup(opts: { a?: string[]; aaaa?: string[]; fetchImpl?: typeof fetch } = {}) {
  const dns = createFakeDns();
  for (const ip of opts.a ?? ["192.0.2.10"]) dns.setRecord("A", HOST, ip);
  for (const ip of opts.aaaa ?? []) dns.setRecord("AAAA", HOST, ip);
  const fetchImpl = opts.fetchImpl ?? (vi.fn() as unknown as typeof fetch);
  return { dns, fetchImpl, probe: new HttpsProbe({ dns: dns.observer, fetchImpl, secret: SECRET }) };
}

/** A deployment that holds the secret: answers the probe header with the right ack. */
const honest = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
  const header = (init?.headers as Record<string, string>)[PROBE_REQUEST_HEADER];
  const ack = answerProbe(HOST, header, SECRET);
  return new Response(null, { status: 204, headers: ack ? { [PROBE_ACK_HEADER]: ack } : {} });
});

describe("HttpsProbe", () => {
  it("ack: a host that returns the ack for THIS probe", async () => {
    const { probe } = setup({ fetchImpl: honest as unknown as typeof fetch });
    expect(await probe.probe(HOST)).toBe("ack");
  });

  it("sends exactly one GET to https://<host>/ with the probe header, no redirects, no cache, a timeout", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    const { probe } = setup({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await probe.probe(HOST);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://${HOST}/`);
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const header = (init.headers as Record<string, string>)[PROBE_REQUEST_HEADER];
    expect(header).toMatch(/^[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
  });

  it("negative: an HTTP answer with no ack, a wrong ack, or a redirect (some OTHER server answered)", async () => {
    for (const make of [
      () => new Response("<html>old site</html>", { status: 200 }),
      () => new Response(null, { status: 404 }),
      () => new Response(null, { status: 204, headers: { [PROBE_ACK_HEADER]: "forged-ack-value" } }),
      () => new Response(null, { status: 301, headers: { location: "https://elsewhere.invalid/" } }),
    ]) {
      const { probe } = setup({ fetchImpl: (async () => make()) as unknown as typeof fetch });
      expect(await probe.probe(HOST)).toBe("negative");
    }
  });

  it("an ack replayed from an earlier probe is negative (the nonce is fresh each time)", async () => {
    let stale: string | null = null;
    const replaying = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const header = (init?.headers as Record<string, string>)[PROBE_REQUEST_HEADER];
      const fresh = answerProbe(HOST, header, SECRET)!;
      const answer = stale ?? fresh;
      stale ??= fresh;
      return new Response(null, { status: 204, headers: { [PROBE_ACK_HEADER]: answer } });
    });
    const { probe } = setup({ fetchImpl: replaying as unknown as typeof fetch });
    expect(await probe.probe(HOST)).toBe("ack");
    expect(await probe.probe(HOST)).toBe("negative");
  });

  it("unknown: a connection failure, a timeout or a TLS error is NOT evidence of anything", async () => {
    for (const thrown of [
      new TypeError("fetch failed"),
      Object.assign(new Error("timeout"), { name: "TimeoutError" }),
      Object.assign(new Error("unable to verify the first certificate"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }),
    ]) {
      const { probe } = setup({
        fetchImpl: (async () => {
          throw thrown;
        }) as unknown as typeof fetch,
      });
      expect(await probe.probe(HOST)).toBe("unknown");
    }
  });

  it("unknown without AUTH_SECRET (never a forgeable probe), and it makes no request", async () => {
    const dns = createFakeDns();
    dns.setRecord("A", HOST, "192.0.2.10");
    const fetchImpl = vi.fn();
    const prior = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    try {
      const probe = new HttpsProbe({ dns: dns.observer, fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(await probe.probe(HOST)).toBe("unknown");
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (prior !== undefined) process.env.AUTH_SECRET = prior;
    }
  });

  describe("the SSRF pre-check", () => {
    it.each([
      ["a loopback A record", { a: ["127.0.0.1"] }],
      ["a private A record", { a: ["10.0.0.5"] }],
      ["the cloud metadata address", { a: ["169.254.169.254"] }],
      ["a private address MIXED in with a public one", { a: ["192.0.2.10", "192.168.0.9"] }],
      ["a loopback AAAA record", { a: ["192.0.2.10"], aaaa: ["::1"] }],
      ["a unique-local AAAA record", { aaaa: ["fd00::1"], a: ["192.0.2.10"] }],
    ])("refuses to connect to %s and reports negative", async (_name, records) => {
      const fetchImpl = vi.fn();
      const { probe } = setup({ ...records, fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(await probe.probe(HOST)).toBe("negative");
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("a name with no A or AAAA record at all (both resolvers say so) is negative, with no request", async () => {
      const dns = createFakeDns();
      const fetchImpl = vi.fn();
      const probe = new HttpsProbe({ dns: dns.observer, fetchImpl: fetchImpl as unknown as typeof fetch, secret: SECRET });
      expect(await probe.probe(HOST)).toBe("negative");
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("...but when a resolver cannot answer, it is unknown, not negative, and still no request", async () => {
      const dns = createFakeDns();
      dns.google.failWith("timeout");
      const fetchImpl = vi.fn();
      const probe = new HttpsProbe({ dns: dns.observer, fetchImpl: fetchImpl as unknown as typeof fetch, secret: SECRET });
      expect(await probe.probe(HOST)).toBe("unknown");
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("a malformed host never reaches DNS or fetch", async () => {
      const fetchImpl = vi.fn();
      const dns = createFakeDns();
      const probe = new HttpsProbe({ dns: dns.observer, fetchImpl: fetchImpl as unknown as typeof fetch, secret: SECRET });
      for (const bad of ["", "a", "x/y.invalid", "a b.invalid", "localhost", "[::1]", "a..invalid", "UPPER.invalid"]) {
        expect(await probe.probe(bad), bad).toBe("negative");
      }
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(dns.queryCount()).toBe(0);
    });
  });

  it("never reads the response body (cancelled) and exposes only the enum", async () => {
    const cancel = vi.fn(async () => {});
    const res = new Response("a very large body", { status: 200 });
    Object.defineProperty(res, "body", { value: { cancel } });
    const { probe } = setup({ fetchImpl: (async () => res) as unknown as typeof fetch });
    expect(await probe.probe(HOST)).toBe("negative");
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
