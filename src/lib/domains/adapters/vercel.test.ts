/**
 * The Vercel adapter against HAND-WRITTEN response fixtures (Phase 3 Batch 1b
 * gate: "adapter tests against recorded-shape fixtures for every row of the
 * error table"). No request ever leaves the process: `fetch` is a stub.
 *
 * The bodies below follow the shapes Vercel documents for the five endpoints
 * (`{ error: { code, message } }` on failure; `{ name, verified, verification[] }`
 * on a domain; `{ misconfigured, recommendedCNAME[], recommendedIPv4[] }` for
 * config). The exact `error.code` strings and message wording are NOT recorded
 * from the live API (no real call is allowed in this pipeline); they are to be
 * pinned during the real-domain acceptance pass, which is why classification
 * leans on the HTTP status and, only where one status carries two meanings, on
 * a message pattern. Every host is a reserved `.invalid` name.
 */
import { describe, expect, it, vi } from "vitest";
import { VercelHosting, VERCEL_API_BASE, type VercelConfig } from "./vercel";

const TOKEN = "tok_test_not_a_real_token";
const CONFIG: VercelConfig = { token: TOKEN, projectId: "prj_test", teamId: "team_test" };
const HOST = "church-one.invalid";

interface Call {
  url: string;
  init: RequestInit;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function harness(respond: (call: Call) => Response | Promise<Response>, config: Partial<VercelConfig> = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return respond(call);
  });
  const hosting = new VercelHosting({ ...CONFIG, ...config, fetchImpl: fetchImpl as unknown as typeof fetch });
  return { hosting, calls, fetchImpl };
}

const err = (code: string, message: string) => ({ error: { code, message } });

const DOMAIN_VERIFIED = { name: HOST, apexName: HOST, projectId: "prj_test", verified: true };
const DOMAIN_UNVERIFIED = {
  name: HOST,
  apexName: HOST,
  projectId: "prj_test",
  verified: false,
  verification: [
    { type: "TXT", domain: `_vercel.${HOST}`, value: "vc-domain-verify=church-one.invalid,abc123", reason: "pending_domain_verification" },
  ],
};
const CONFIG_BODY = {
  configuredBy: "CNAME",
  acceptedChallenges: ["dns-01", "http-01"],
  misconfigured: false,
  recommendedIPv4: [
    { rank: 2, value: ["192.0.2.22"] },
    { rank: 1, value: ["192.0.2.10", "192.0.2.11"] },
  ],
  recommendedCNAME: [
    { rank: 2, value: "cname-b.vercel-dns.invalid" },
    { rank: 1, value: "cname-a.vercel-dns.invalid" },
  ],
};

describe("VercelHosting.addDomain - request shape", () => {
  it("POSTs { name } to /v10/projects/{id}/domains with the team, a bearer token, JSON, a timeout signal, and no redirects", async () => {
    const { hosting, calls } = harness(() => json(200, DOMAIN_VERIFIED));
    await hosting.addDomain(HOST);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(`${VERCEL_API_BASE}/v10/projects/prj_test/domains?teamId=team_test`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: HOST }));
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers["content-type"]).toBe("application/json");
  });

  it("omits teamId for a personal account", async () => {
    const { hosting, calls } = harness(() => json(200, DOMAIN_VERIFIED), { teamId: undefined });
    await hosting.addDomain(HOST);
    expect(calls[0]!.url).toBe(`${VERCEL_API_BASE}/v10/projects/prj_test/domains`);
  });

  it("never sends a request for a name that is not a plain hostname", async () => {
    const { hosting, fetchImpl } = harness(() => json(200, DOMAIN_VERIFIED));
    for (const bad of ["", "a", "a..b", "x/../y", "host?teamId=evil", "a b.invalid", "-a.invalid", "UPPER.invalid", "a.invalid/"]) {
      expect(await hosting.addDomain(bad), bad).toEqual({ kind: "rejected", reason: "invalid_domain" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("VercelHosting.addDomain - every row of the error table", () => {
  const add = async (res: Response | (() => Response)) => {
    const { hosting } = harness(() => (typeof res === "function" ? res() : res));
    return hosting.addDomain(HOST);
  };

  it("200 verified -> ok, no challenge", async () => {
    expect(await add(json(200, DOMAIN_VERIFIED))).toEqual({ kind: "ok", verified: true, verification: [] });
  });

  it("200 unverified -> ok with the provider's challenge parsed (a name in another Vercel account)", async () => {
    expect(await add(json(200, DOMAIN_UNVERIFIED))).toEqual({
      kind: "ok",
      verified: false,
      verification: [
        { type: "TXT", domain: `_vercel.${HOST}`, value: "vc-domain-verify=church-one.invalid,abc123", reason: "pending_domain_verification" },
      ],
    });
  });

  it("200 with `verified` absent and no challenge is treated as verified; garbage challenge entries are dropped", async () => {
    expect(await add(json(200, { name: HOST }))).toEqual({ kind: "ok", verified: true, verification: [] });
    expect(
      await add(json(200, { name: HOST, verified: false, verification: [null, 3, { type: "TXT" }, { type: "TXT", domain: "d", value: "v" }] })),
    ).toEqual({ kind: "ok", verified: false, verification: [{ type: "TXT", domain: "d", value: "v", reason: "" }] });
  });

  it("200 with an unreadable body -> retryable (the add is idempotent, so retry)", async () => {
    expect(await add(json(200, "not json"))).toEqual({ kind: "retryable", reason: "unavailable" });
    expect(await add(json(200, "[]"))).toEqual({ kind: "retryable", reason: "unavailable" });
  });

  it("400 'already exists on the project' -> already_on_project (IDEMPOTENT success), across message wordings", async () => {
    for (const message of [
      `The domain "${HOST}" already exists on the project.`,
      `Domain ${HOST} is already assigned to this project.`,
      "Domain already added to the project",
      "Domain already in use on this project",
    ]) {
      expect(await add(json(400, err("bad_request", message))), message).toEqual({ kind: "already_on_project" });
    }
  });

  it("400 'already ... another project/account' is NOT idempotent success", async () => {
    const r = await add(json(400, err("bad_request", `The domain "${HOST}" is already in use by another project.`)));
    expect(r.kind).not.toBe("already_on_project");
    expect(r).toEqual({ kind: "rejected", reason: "invalid_domain" });
  });

  it("400 'latest production deployment was not successful' -> retryable: deployment_not_ready", async () => {
    for (const message of [
      "The latest production deployment was not successful.",
      "Cannot add domain: the latest production deployment has not been successful yet.",
      "Latest production deployment is not ready.",
    ]) {
      expect(await add(json(400, err("bad_request", message))), message).toEqual({
        kind: "retryable",
        reason: "deployment_not_ready",
      });
    }
  });

  it("400 other -> rejected: invalid_domain", async () => {
    expect(await add(json(400, err("invalid_domain", "Invalid domain name")))).toEqual({ kind: "rejected", reason: "invalid_domain" });
    expect(await add(json(400, "oops"))).toEqual({ kind: "rejected", reason: "invalid_domain" });
  });

  it("401 -> config_error: token_invalid", async () => {
    expect(await add(json(401, err("forbidden", "Not authorized")))).toEqual({ kind: "config_error", reason: "token_invalid" });
  });

  it("402 -> config_error: payment_required", async () => {
    expect(await add(json(402, err("payment_required", "Upgrade")))).toEqual({ kind: "config_error", reason: "payment_required" });
  });

  it("403 'You don't have access to the domain you are adding' -> blocked: no_access (the NAME is the problem)", async () => {
    expect(await add(json(403, err("forbidden", "You don't have access to the domain you are adding.")))).toEqual({
      kind: "blocked",
      reason: "no_access",
    });
  });

  it("403 any other message -> config_error: token_forbidden (OUR token may not do this)", async () => {
    expect(await add(json(403, err("forbidden", "Not authorized to perform this action")))).toEqual({
      kind: "config_error",
      reason: "token_forbidden",
    });
    expect(await add(json(403, ""))).toEqual({ kind: "config_error", reason: "token_forbidden" });
  });

  it("404 -> config_error: project_missing", async () => {
    expect(await add(json(404, err("not_found", "Project not found")))).toEqual({ kind: "config_error", reason: "project_missing" });
    expect(await add(json(404, err("not_found", "Domain not found")))).toEqual({ kind: "config_error", reason: "project_missing" });
  });

  it("409 -> blocked: other_project", async () => {
    expect(await add(json(409, err("domain_already_in_use", "Domain is assigned to another project")))).toEqual({
      kind: "blocked",
      reason: "other_project",
    });
  });

  it("429 -> retryable: rate_limited, honouring a sane retry-after and ignoring a silly one", async () => {
    expect(await add(json(429, err("rate_limited", "Too many requests"), { "retry-after": "42" }))).toEqual({
      kind: "retryable",
      reason: "rate_limited",
      retryAfterSeconds: 42,
    });
    expect(await add(json(429, err("rate_limited", "x")))).toEqual({
      kind: "retryable",
      reason: "rate_limited",
      retryAfterSeconds: undefined,
    });
    for (const silly of ["0", "-5", "abc", "999999999", ""]) {
      expect(await add(json(429, err("rate_limited", "x"), { "retry-after": silly })), silly).toMatchObject({
        kind: "retryable",
        reason: "rate_limited",
        retryAfterSeconds: undefined,
      });
    }
  });

  it("5xx -> retryable: unavailable (and carries retry-after)", async () => {
    for (const status of [500, 502, 503, 504]) {
      expect(await add(json(status, err("internal", "boom"))), String(status)).toMatchObject({ kind: "retryable", reason: "unavailable" });
    }
    expect(await add(json(503, "", { "retry-after": "7" }))).toEqual({ kind: "retryable", reason: "unavailable", retryAfterSeconds: 7 });
  });

  it("a network failure and a timeout -> retryable: unavailable", async () => {
    const net = harness(() => {
      throw new TypeError("fetch failed");
    });
    expect(await net.hosting.addDomain(HOST)).toEqual({ kind: "retryable", reason: "unavailable" });
    const timeout = harness(() => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    expect(await timeout.hosting.addDomain(HOST)).toEqual({ kind: "retryable", reason: "unavailable" });
  });

  it("any other 4xx -> rejected: unknown (never a guess)", async () => {
    for (const status of [405, 410, 418, 422]) {
      expect(await add(json(status, err("weird", "???"))), String(status)).toEqual({ kind: "rejected", reason: "unknown" });
    }
  });

  it("a redirect response is a rejected unknown (fetch is told not to follow; a 3xx is not success)", async () => {
    expect(await add(new Response(null, { status: 302, headers: { location: "https://elsewhere.invalid/" } }))).toEqual({
      kind: "rejected",
      reason: "unknown",
    });
  });
});

describe("VercelHosting - no provider text and no token ever leave the adapter (G30)", () => {
  it("results carry none of the provider's message text, and never the token", async () => {
    const secretMessage = "SECRET-PROVIDER-WORDING-12345 for the project of Some Real Customer";
    const cases: Array<[number, unknown]> = [
      [400, err("bad_request", secretMessage)],
      [401, err("forbidden", secretMessage)],
      [403, err("forbidden", secretMessage)],
      [404, err("not_found", secretMessage)],
      [409, err("conflict", secretMessage)],
      [429, err("rate_limited", secretMessage)],
      [500, err("internal", secretMessage)],
      [418, err("teapot", secretMessage)],
    ];
    for (const [status, body] of cases) {
      const { hosting } = harness(() => json(status, body));
      for (const result of [
        await hosting.addDomain(HOST),
        await hosting.getDomain(HOST),
        await hosting.verifyDomain(HOST),
        await hosting.getConfig(HOST),
        await hosting.removeDomain(HOST),
      ]) {
        const text = JSON.stringify(result);
        expect(text, String(status)).not.toContain("SECRET-PROVIDER");
        expect(text, String(status)).not.toContain(TOKEN);
      }
    }
  });

  it("does not log anything (no console output on any path)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      for (const status of [200, 400, 401, 403, 404, 409, 429, 500]) {
        const { hosting } = harness(() => json(status, err("x", "y")));
        await hosting.addDomain(HOST);
        await hosting.getDomain(HOST);
        await hosting.removeDomain(HOST);
        await hosting.getConfig(HOST);
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("VercelHosting.getDomain", () => {
  it("GETs /v9/projects/{id}/domains/{host} and returns verification state", async () => {
    const { hosting, calls } = harness(() => json(200, DOMAIN_UNVERIFIED));
    const r = await hosting.getDomain(HOST);
    expect(calls[0]!.url).toBe(`${VERCEL_API_BASE}/v9/projects/prj_test/domains/${HOST}?teamId=team_test`);
    expect(calls[0]!.init.method).toBe("GET");
    expect(r).toMatchObject({ kind: "ok", verified: false });
    expect(r.kind === "ok" && r.verification).toHaveLength(1);
  });

  it("a domain that is not on the project is not_found; a missing PROJECT is our config error", async () => {
    expect(await harness(() => json(404, err("not_found", "Domain not found"))).hosting.getDomain(HOST)).toEqual({ kind: "not_found" });
    expect(await harness(() => json(404, "")).hosting.getDomain(HOST)).toEqual({ kind: "not_found" });
    expect(await harness(() => json(404, err("not_found", "Project not found"))).hosting.getDomain(HOST)).toEqual({
      kind: "config_error",
      reason: "project_missing",
    });
  });

  it("maps 401/402/403, 429, 5xx, other 4xx and network failures", async () => {
    expect(await harness(() => json(401, "")).hosting.getDomain(HOST)).toEqual({ kind: "config_error", reason: "token_invalid" });
    expect(await harness(() => json(402, "")).hosting.getDomain(HOST)).toEqual({ kind: "config_error", reason: "payment_required" });
    expect(await harness(() => json(403, "")).hosting.getDomain(HOST)).toEqual({ kind: "config_error", reason: "token_forbidden" });
    expect(await harness(() => json(429, "", { "retry-after": "9" })).hosting.getDomain(HOST)).toEqual({
      kind: "retryable",
      reason: "rate_limited",
      retryAfterSeconds: 9,
    });
    expect(await harness(() => json(503, "")).hosting.getDomain(HOST)).toMatchObject({ kind: "retryable", reason: "unavailable" });
    expect(await harness(() => json(418, "")).hosting.getDomain(HOST)).toEqual({ kind: "rejected", reason: "unknown" });
    expect(
      await harness(() => {
        throw new TypeError("fetch failed");
      }).hosting.getDomain(HOST),
    ).toEqual({ kind: "retryable", reason: "unavailable" });
  });
});

describe("VercelHosting.verifyDomain", () => {
  it("POSTs to .../verify; 200 reports the new verification state", async () => {
    const { hosting, calls } = harness(() => json(200, DOMAIN_VERIFIED));
    expect(await hosting.verifyDomain(HOST)).toEqual({ kind: "ok", verified: true, verification: [] });
    expect(calls[0]!.url).toBe(`${VERCEL_API_BASE}/v9/projects/prj_test/domains/${HOST}/verify?teamId=team_test`);
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("400 means 'the challenge is not there yet' (not_verified), 404 not_found, the rest as elsewhere", async () => {
    expect(await harness(() => json(400, err("verification_failed", "no record"))).hosting.verifyDomain(HOST)).toEqual({ kind: "not_verified" });
    expect(await harness(() => json(404, err("not_found", "Domain not found"))).hosting.verifyDomain(HOST)).toEqual({ kind: "not_found" });
    expect(await harness(() => json(401, "")).hosting.verifyDomain(HOST)).toEqual({ kind: "config_error", reason: "token_invalid" });
    expect(await harness(() => json(500, "")).hosting.verifyDomain(HOST)).toMatchObject({ kind: "retryable", reason: "unavailable" });
  });
});

describe("VercelHosting.getConfig (best effort)", () => {
  it("reads /v6/domains/{host}/config with the project and picks the LOWEST-ranked recommendations", async () => {
    const { hosting, calls } = harness(() => json(200, CONFIG_BODY));
    const r = await hosting.getConfig(HOST);
    expect(calls[0]!.url).toBe(`${VERCEL_API_BASE}/v6/domains/${HOST}/config?projectIdOrName=prj_test&teamId=team_test`);
    expect(r).toEqual({
      kind: "ok",
      misconfigured: false,
      recommendedCname: "cname-a.vercel-dns.invalid",
      recommendedIpv4: ["192.0.2.10", "192.0.2.11"],
    });
  });

  it("tolerates a missing or malformed recommendation (empty targets, not an error)", async () => {
    expect(await harness(() => json(200, { misconfigured: true })).hosting.getConfig(HOST)).toEqual({
      kind: "ok",
      misconfigured: true,
      recommendedCname: null,
      recommendedIpv4: [],
    });
    expect(
      await harness(() => json(200, { misconfigured: false, recommendedCNAME: [{ rank: 1, value: 7 }], recommendedIPv4: "x" })).hosting.getConfig(HOST),
    ).toEqual({ kind: "ok", misconfigured: false, recommendedCname: null, recommendedIpv4: [] });
  });

  it("a PROJECT-SCOPED TOKEN REFUSED on the team-level endpoint (401/403) degrades to 'denied' - correctness never depends on it", async () => {
    expect(await harness(() => json(403, err("forbidden", "Not authorized"))).hosting.getConfig(HOST)).toEqual({ kind: "unavailable", reason: "denied" });
    expect(await harness(() => json(401, err("forbidden", "Not authorized"))).hosting.getConfig(HOST)).toEqual({ kind: "unavailable", reason: "denied" });
  });

  it("every other failure is 'unavailable' too, never a throw and never config_error", async () => {
    expect(await harness(() => json(404, "")).hosting.getConfig(HOST)).toEqual({ kind: "unavailable", reason: "not_found" });
    expect(await harness(() => json(429, "")).hosting.getConfig(HOST)).toEqual({ kind: "unavailable", reason: "rate_limited" });
    expect(await harness(() => json(500, "")).hosting.getConfig(HOST)).toEqual({ kind: "unavailable", reason: "unavailable" });
    expect(await harness(() => json(200, "not json")).hosting.getConfig(HOST)).toEqual({ kind: "unavailable", reason: "unavailable" });
    expect(
      await harness(() => {
        throw new TypeError("fetch failed");
      }).hosting.getConfig(HOST),
    ).toEqual({ kind: "unavailable", reason: "unavailable" });
  });
});

describe("VercelHosting.removeDomain", () => {
  it("DELETEs /v9/projects/{id}/domains/{host}; 2xx is ok", async () => {
    const { hosting, calls } = harness(() => json(200, {}));
    expect(await hosting.removeDomain(HOST)).toEqual({ kind: "ok" });
    expect(calls[0]!.url).toBe(`${VERCEL_API_BASE}/v9/projects/prj_test/domains/${HOST}?teamId=team_test`);
    expect(calls[0]!.init.method).toBe("DELETE");
  });

  it("DELETE of a domain that is not there (404) is ok: idempotent detach", async () => {
    expect(await harness(() => json(404, err("not_found", "Domain not found"))).hosting.removeDomain(HOST)).toEqual({ kind: "ok" });
    expect(await harness(() => json(404, "")).hosting.removeDomain(HOST)).toEqual({ kind: "ok" });
  });

  it("...but a missing PROJECT must not read as 'detached'", async () => {
    expect(await harness(() => json(404, err("not_found", "Project not found"))).hosting.removeDomain(HOST)).toEqual({
      kind: "config_error",
      reason: "project_missing",
    });
  });

  it("maps credentials, rate limits, outages and everything else", async () => {
    expect(await harness(() => json(401, "")).hosting.removeDomain(HOST)).toEqual({ kind: "config_error", reason: "token_invalid" });
    expect(await harness(() => json(403, "")).hosting.removeDomain(HOST)).toEqual({ kind: "config_error", reason: "token_forbidden" });
    expect(await harness(() => json(402, "")).hosting.removeDomain(HOST)).toEqual({ kind: "config_error", reason: "payment_required" });
    expect(await harness(() => json(429, "", { "retry-after": "3" })).hosting.removeDomain(HOST)).toEqual({
      kind: "retryable",
      reason: "rate_limited",
      retryAfterSeconds: 3,
    });
    expect(await harness(() => json(502, "")).hosting.removeDomain(HOST)).toMatchObject({ kind: "retryable", reason: "unavailable" });
    expect(await harness(() => json(409, "")).hosting.removeDomain(HOST)).toEqual({ kind: "rejected", reason: "unknown" });
    expect(await harness(() => json(400, "")).hosting.removeDomain(HOST)).toEqual({ kind: "rejected", reason: "unknown" });
    expect(
      await harness(() => {
        throw new TypeError("fetch failed");
      }).hosting.removeDomain(HOST),
    ).toEqual({ kind: "retryable", reason: "unavailable" });
  });
});
