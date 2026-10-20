/**
 * The DNS adapter: DoH response parsing against recorded-shape fixtures, the
 * transport's failure mapping, and the two-resolver quorum rule (Phase 3 API
 * Contract section 5; Batch 1a-ii gate: "DoH quorum incl. disagreement ->
 * unknown"). No network: `fetch` is injected, the resolvers are the fake.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CLOUDFLARE_DOH,
  DohResolver,
  GOOGLE_DOH,
  QuorumDnsObserver,
  createDohObserver,
  isQueryableName,
  parseDohResponse,
  parseTxtData,
} from "./dns";
import { createFakeDns, fileStateReader, FakeDnsResolver } from "./fake";
import { checkProof } from "../dns-checks";
import { getAdapters } from "./index";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN = "T0kenT0kenT0kenT0kenT0kenT0kenT0ken";
const PROOF = `presby-verify=${TOKEN}`;
const CLAIM = "church-one.invalid";
const NAME = `_presby-challenge.${CLAIM}`;

// Shapes recorded from the two providers' JSON APIs (field names and casing
// as returned; values synthetic).
const CLOUDFLARE_TXT = {
  Status: 0,
  TC: false,
  RD: true,
  RA: true,
  AD: false,
  CD: false,
  Question: [{ name: NAME, type: 16 }],
  Answer: [{ name: NAME, type: 16, TTL: 300, data: `"${PROOF}"` }],
};
const GOOGLE_TXT_MULTI = {
  Status: 0,
  TC: false,
  RD: true,
  RA: true,
  AD: true,
  CD: false,
  Question: [{ name: `${NAME}.`, type: 16 }],
  Answer: [
    { name: `${NAME}.`, type: 16, TTL: 60, data: '"presby-verify=T0kenT0kenT0kenT0ken" "T0kenT0kenT0ken"' },
  ],
};
const NXDOMAIN = { Status: 3, TC: false, RD: true, RA: true, AD: false, CD: false, Question: [{ name: NAME, type: 16 }] };

describe("parseTxtData", () => {
  it.each([
    ['"abc"', "abc"],
    ['"a" "b" "c"', "abc"],
    ['"say \\"hi\\""', 'say "hi"'],
    ['"back\\\\slash"', "back\\slash"],
    ['"nul\\065x"', "nulAx"],
    ["unquoted", "unquoted"],
    ['""', ""],
  ])("%s -> %j", (raw, expected) => {
    expect(parseTxtData(raw)).toBe(expected);
  });
});

describe("parseDohResponse", () => {
  it("reads a Cloudflare TXT answer (unquoted, lowercase owner, no AD)", () => {
    expect(parseDohResponse(CLOUDFLARE_TXT, "TXT")).toEqual({
      kind: "ok",
      rcode: "noerror",
      authenticated: false,
      records: [{ type: "TXT", name: NAME, data: PROOF, ttl: 300 }],
    });
  });

  it("reads a Google multi-segment TXT answer, strips the trailing dot and reads AD", () => {
    const parsed = parseDohResponse(GOOGLE_TXT_MULTI, "TXT");
    expect(parsed).toMatchObject({ kind: "ok", rcode: "noerror", authenticated: true });
    if (parsed.kind !== "ok") throw new Error("unreachable");
    expect(parsed.records[0]).toMatchObject({ name: NAME, data: "presby-verify=T0kenT0kenT0kenT0kenT0kenT0kenT0ken" });
  });

  it("NXDOMAIN is an ok answer with no records", () => {
    expect(parseDohResponse(NXDOMAIN, "TXT")).toEqual({
      kind: "ok",
      rcode: "nxdomain",
      records: [],
      authenticated: false,
    });
  });

  it("NOERROR with no Answer is an ok answer with no records", () => {
    expect(parseDohResponse({ Status: 0 }, "TXT")).toMatchObject({ kind: "ok", rcode: "noerror", records: [] });
  });

  it("keeps only the queried type, dropping a CNAME chain", () => {
    const body = {
      Status: 0,
      Answer: [
        { name: "www.church-one.invalid.", type: 5, TTL: 60, data: "cname.vercel-dns.invalid." },
        { name: "cname.vercel-dns.invalid.", type: 1, TTL: 60, data: "203.0.113.9" },
      ],
    };
    const a = parseDohResponse(body, "A");
    expect(a).toMatchObject({ kind: "ok" });
    if (a.kind !== "ok") throw new Error("unreachable");
    expect(a.records).toEqual([{ type: "A", name: "cname.vercel-dns.invalid", data: "203.0.113.9", ttl: 60 }]);
    const c = parseDohResponse(body, "CNAME");
    if (c.kind !== "ok") throw new Error("unreachable");
    expect(c.records).toEqual([
      { type: "CNAME", name: "www.church-one.invalid", data: "cname.vercel-dns.invalid", ttl: 60 },
    ]);
  });

  it.each([2, 4, 5, 9])("Status %d (SERVFAIL, NOTIMP, REFUSED...) is an error, never 'absent'", (status) => {
    expect(parseDohResponse({ Status: status }, "TXT")).toEqual({ kind: "error", reason: "servfail" });
  });

  it.each([
    ["null", null],
    ["a string", "nope"],
    ["no Status", { Answer: [] }],
    ["Status as a string", { Status: "0" }],
    ["Answer not an array", { Status: 0, Answer: "x" }],
    ["an Answer entry that is not an object", { Status: 0, Answer: ["x"] }],
    ["an Answer entry missing data", { Status: 0, Answer: [{ name: "a.", type: 16 }] }],
  ])("%s is malformed", (_label, body) => {
    expect(parseDohResponse(body, "TXT")).toEqual({ kind: "error", reason: "malformed" });
  });
});

describe("isQueryableName", () => {
  it.each([NAME, "church-one.invalid", "a.b", "_dmarc.a.b"])("accepts %s", (n) => {
    expect(isQueryableName(n)).toBe(true);
  });
  it.each(["", "a b.invalid", "a/b.invalid", "a?x=1.invalid", "a#b.invalid", "a..b", ".a", "a.", "a.b\n", `${"a".repeat(64)}.b`, "x".repeat(254)])(
    "refuses %j",
    (n) => {
      expect(isQueryableName(n)).toBe(false);
    },
  );
});

function response(body: unknown, init: { ok?: boolean; status?: number; jsonThrows?: boolean } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: init.jsonThrows ? async () => { throw new SyntaxError("bad json"); } : async () => body,
  } as unknown as Response;
}

describe("DohResolver transport", () => {
  it("queries the fixed endpoint with the dns-json accept header, no redirects, no caching", async () => {
    const fetchMock = vi.fn(async () => response(CLOUDFLARE_TXT));
    const resolver = new DohResolver("cloudflare", CLOUDFLARE_DOH, fetchMock as unknown as typeof fetch);
    const answer = await resolver.query(NAME, "TXT");
    expect(answer.kind).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${CLOUDFLARE_DOH}?name=${encodeURIComponent(NAME)}&type=TXT`);
    expect(init.headers).toEqual({ accept: "application/dns-json" });
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the Google endpoint for the Google resolver", async () => {
    const fetchMock = vi.fn(async () => response(NXDOMAIN));
    await createDohObserver(fetchMock as unknown as typeof fetch).lookup(NAME, "TXT");
    const urls = fetchMock.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls.some((u) => u.startsWith(CLOUDFLARE_DOH))).toBe(true);
    expect(urls.some((u) => u.startsWith(GOOGLE_DOH))).toBe(true);
  });

  it("an unqueryable name is rejected WITHOUT a request", async () => {
    const fetchMock = vi.fn();
    const resolver = new DohResolver("g", GOOGLE_DOH, fetchMock as unknown as typeof fetch);
    expect(await resolver.query("evil.invalid/../x", "TXT")).toEqual({ kind: "error", reason: "malformed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a timeout, a network failure, a non-200 and bad JSON to distinct error reasons", async () => {
    const mk = (impl: () => Promise<Response>) =>
      new DohResolver("x", GOOGLE_DOH, vi.fn(impl) as unknown as typeof fetch).query(NAME, "TXT");
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    const abort = Object.assign(new Error("a"), { name: "AbortError" });
    expect(await mk(async () => { throw timeout; })).toEqual({ kind: "error", reason: "timeout" });
    expect(await mk(async () => { throw abort; })).toEqual({ kind: "error", reason: "timeout" });
    expect(await mk(async () => { throw new TypeError("fetch failed"); })).toEqual({ kind: "error", reason: "http_error" });
    expect(await mk(async () => response({}, { ok: false, status: 503 }))).toEqual({ kind: "error", reason: "http_error" });
    expect(await mk(async () => response(null, { jsonThrows: true }))).toEqual({ kind: "error", reason: "malformed" });
  });
});

describe("the two-resolver quorum", () => {
  const MATCH = (r: { data: string }) => r.data === PROOF;

  function dns() {
    return createFakeDns();
  }

  it("present: both resolvers show the record", async () => {
    const d = dns();
    d.setRecord("TXT", NAME, PROOF);
    expect(await d.observer.lookup(NAME, "TXT", MATCH)).toMatchObject({ kind: "present" });
  });

  it("present: ONE resolver showing it is enough, even if the other disagrees (stale cache)", async () => {
    const d = dns();
    d.cloudflare.setRecord("TXT", NAME, PROOF);
    expect((await d.observer.lookup(NAME, "TXT", MATCH)).kind).toBe("present");
  });

  it("present: ONE resolver showing it is enough even if the other ERRORS", async () => {
    const d = dns();
    d.cloudflare.setRecord("TXT", NAME, PROOF);
    d.google.failWith("timeout");
    expect((await d.observer.lookup(NAME, "TXT", MATCH)).kind).toBe("present");
  });

  it("absent: BOTH answered ok and neither shows it (NXDOMAIN and an empty NOERROR alike)", async () => {
    const d = dns();
    d.google.setRecord("A", NAME, "203.0.113.9"); // the name exists for google, with no TXT
    expect((await d.observer.lookup(NAME, "TXT", MATCH)).kind).toBe("absent");
  });

  it.each(["timeout", "servfail", "http_error", "malformed"] as const)(
    "unknown, never absent: one resolver ok-and-empty, the other %s",
    async (reason) => {
      const d = dns();
      d.google.failWith(reason);
      expect((await d.observer.lookup(NAME, "TXT", MATCH)).kind).toBe("unknown");
      d.google.failWith(null);
      d.cloudflare.failWith(reason);
      expect((await d.observer.lookup(NAME, "TXT", MATCH)).kind).toBe("unknown");
    },
  );

  it("unknown: both resolvers error", async () => {
    const d = dns();
    d.cloudflare.failWith("timeout");
    d.google.failWith("servfail");
    expect((await d.observer.lookup(NAME, "TXT", MATCH)).kind).toBe("unknown");
  });

  it("a resolver that THROWS is treated as an error, not as absence", async () => {
    const throwing: FakeDnsResolver = new FakeDnsResolver("boom");
    throwing.query = async () => { throw new Error("socket hang up"); };
    const ok = new FakeDnsResolver("ok");
    const observer = new QuorumDnsObserver([throwing, ok]);
    expect((await observer.lookup(NAME, "TXT", MATCH)).kind).toBe("unknown");
  });

  it("requires at least one resolver", () => {
    expect(() => new QuorumDnsObserver([])).toThrow();
  });
});

describe("checkProof", () => {
  it("present when the expected value is there, among other TXT", async () => {
    const d = createFakeDns();
    d.setRecord("TXT", NAME, "v=spf1 -all", PROOF);
    expect(await checkProof(d.observer, CLAIM, TOKEN)).toEqual({ status: "present" });
  });

  it("absent when the name holds nothing", async () => {
    const d = createFakeDns();
    expect(await checkProof(d.observer, CLAIM, TOKEN)).toEqual({ status: "absent" });
  });

  it("absent (not wrong_value) when the name holds only unrelated TXT", async () => {
    const d = createFakeDns();
    d.setRecord("TXT", NAME, "v=spf1 -all");
    expect(await checkProof(d.observer, CLAIM, TOKEN)).toEqual({ status: "absent" });
  });

  it("wrong_value when both answered and the name holds a DIFFERENT presby-verify= value", async () => {
    const d = createFakeDns();
    d.setRecord("TXT", NAME, "presby-verify=SomeoneElsesTokenSomeoneElsesToken");
    expect(await checkProof(d.observer, CLAIM, TOKEN)).toEqual({ status: "wrong_value" });
  });

  it("unknown when a resolver errored and the other shows only the wrong value", async () => {
    const d = createFakeDns();
    d.cloudflare.setRecord("TXT", NAME, "presby-verify=SomeoneElsesTokenSomeoneElsesToken");
    d.google.failWith("timeout");
    expect(await checkProof(d.observer, CLAIM, TOKEN)).toEqual({ status: "unknown" });
  });

  it("queries the proof name `_presby-challenge.<claim name>`, once per resolver", async () => {
    const d = createFakeDns();
    d.setRecord("TXT", NAME, PROOF);
    await checkProof(d.observer, CLAIM, TOKEN);
    expect(d.cloudflare.calls).toEqual([{ name: NAME, type: "TXT" }]);
    expect(d.google.calls).toEqual([{ name: NAME, type: "TXT" }]);
  });
});

describe("provider selection and the fake's state file", () => {
  it("defaults to the DoH observer, and ignores 'fake' in production", () => {
    const real = getAdapters({}).dns;
    expect(getAdapters({ DOMAINS_DNS_PROVIDER: "fake", NODE_ENV: "production" }).dns).toBe(real);
    expect(getAdapters({ DOMAINS_DNS_PROVIDER: "fake", VERCEL_ENV: "production" }).dns).toBe(real);
    expect(getAdapters({ DOMAINS_DNS_PROVIDER: "fake", NODE_ENV: "test" }).dns).not.toBe(real);
  });

  it("the state file is read on every query, and ignored in production", async () => {
    const dir = mkdtempSync(join(tmpdir(), "domains-fake-"));
    const file = join(dir, "state.json");
    try {
      const d = createFakeDns(fileStateReader(file));
      expect((await d.observer.lookup(NAME, "TXT")).kind).toBe("absent");

      writeFileSync(file, JSON.stringify({ dns: { zone: { [`TXT ${NAME}`]: [PROOF] } } }));
      expect((await d.observer.lookup(NAME, "TXT")).kind).toBe("present");

      writeFileSync(file, JSON.stringify({ dns: { zone: {}, errors: { google: "timeout" } } }));
      expect((await d.observer.lookup(NAME, "TXT")).kind).toBe("unknown");

      writeFileSync(file, JSON.stringify({ dns: { perResolver: { cloudflare: { [`TXT ${NAME}`]: [PROOF] } } } }));
      expect((await d.observer.lookup(NAME, "TXT")).kind).toBe("present");

      writeFileSync(file, "{ not json");
      expect((await d.observer.lookup(NAME, "TXT")).kind).toBe("absent");

      writeFileSync(file, JSON.stringify({ dns: { zone: { [`TXT ${NAME}`]: [PROOF] } } }));
      const original = process.env.NODE_ENV;
      vi.stubEnv("NODE_ENV", "production");
      try {
        expect((await d.observer.lookup(NAME, "TXT")).kind).toBe("absent");
      } finally {
        vi.stubEnv("NODE_ENV", original ?? "test");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
