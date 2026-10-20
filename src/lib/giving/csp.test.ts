import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The enforced Content-Security-Policy on the online-giving routes
 * (docs/work-log/2026-10-15-online-giving.md, Batch 4; R7 / G30 / SAQ-A). Reads
 * the REAL `next.config.ts` `headers()`. `e2e/security-headers.spec.ts` proves
 * the same thing over HTTP against a running server; this is the fast guard.
 */

type HeaderEntry = {
  source: string;
  has?: Array<{ type: string; value?: string }>;
  missing?: Array<{ type: string; value?: string }>;
  headers: Array<{ key: string; value: string }>;
};

async function loadHeaders(nodeEnv: string): Promise<HeaderEntry[]> {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  const mod = await import("../../../next.config");
  return (await mod.default.headers!()) as HeaderEntry[];
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// `/give/:path*` is the church-domain form of the same route (Track F, T13): `headers()` matches
// the INCOMING path, before the proxy's rewrite, so a custom host's clean `/give` needs its own entry.
const GIVE_SOURCES = ["/site/:slug/give/:path*", "/o/:slug/giving/give/:path*", "/give/:path*"];

/** The give entries: those that carry the ENFORCED header. */
const giveEntries = (entries: HeaderEntry[]) => entries.filter((e) => e.headers.some((h) => h.key === "Content-Security-Policy"));
/** The two host-conditioned HSTS entries (platform, then every other host). */
const hsts = (entries: HeaderEntry[]) =>
  entries.filter((e) => e.headers.some((h) => h.key === "Strict-Transport-Security"));
/** The site-wide report-only entry. */
const siteEntry = (entries: HeaderEntry[]) =>
  entries.find((e) => e.headers.some((h) => h.key === "Content-Security-Policy-Report-Only"))!;

describe("next.config.ts headers(): the enforced CSP on the give routes", () => {
  it("has the site-wide entry, the two host-split HSTS entries, and one enforced entry per give route, and no other", async () => {
    const entries = await loadHeaders("production");
    expect(entries.map((e) => e.source)).toEqual(["/(.*)", "/(.*)", "/(.*)", ...GIVE_SOURCES]);
    expect(giveEntries(entries).map((e) => e.source)).toEqual(GIVE_SOURCES);
  });

  it("the /give/:path* entry is HOST-AGNOSTIC (no has/missing): it must fire for a church's own domain", async () => {
    const entry = (await loadHeaders("production")).find((e) => e.source === "/give/:path*")!;
    expect(entry.has).toBeUndefined();
    expect(entry.missing).toBeUndefined();
  });

  it("the site-wide entry stays REPORT-ONLY and carries no enforced policy", async () => {
    const site = siteEntry(await loadHeaders("production"));
    const keys = site.headers.map((h) => h.key);
    expect(keys).toContain("Content-Security-Policy-Report-Only");
    expect(keys).not.toContain("Content-Security-Policy");
  });

  it.each(["production", "development"])(
    "[%s] the give entries carry ONLY the enforced header, and its value is the report-only string, byte for byte",
    async (mode) => {
      const entries = await loadHeaders(mode);
      const reportOnly = siteEntry(entries).headers.find((h) => h.key === "Content-Security-Policy-Report-Only")!.value;
      for (const entry of giveEntries(entries)) {
        expect(entry.headers.map((h) => h.key)).toEqual(["Content-Security-Policy"]);
        expect(entry.headers[0]!.value).toBe(reportOnly);
      }
    },
  );

  it("names no Stripe origin anywhere: a donor reaches Checkout by redirect, never by an embed or a form post", async () => {
    for (const mode of ["production", "development"]) {
      const entries = await loadHeaders(mode);
      for (const entry of entries) {
        for (const header of entry.headers) expect(header.value, `${mode} ${header.key}`).not.toMatch(/stripe/i);
      }
    }
  });

  it("keeps form-action 'self', frame-ancestors 'none' and no wildcard source", async () => {
    const entries = await loadHeaders("production");
    const csp = giveEntries(entries)[0]!.headers[0]!.value;
    const directive = (name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
    expect(directive("form-action")).toBe("form-action 'self'");
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
    expect(directive("default-src")).toBe("default-src 'self'");
    expect(csp).not.toMatch(/(^|[\s;])\*([\s;]|$)/);
    expect(csp).not.toContain("http:");
  });

  it("'unsafe-eval' exists ONLY in development (React's dev build needs it); a production build never ships it", async () => {
    const production = giveEntries(await loadHeaders("production"))[0]!.headers[0]!.value;
    const development = giveEntries(await loadHeaders("development"))[0]!.headers[0]!.value;
    expect(production).not.toContain("unsafe-eval");
    expect(development).toContain("'unsafe-eval'");
    expect(development.replace(" 'unsafe-eval'", "")).toBe(production);
  });
});

describe("next.config.ts headers(): HSTS is split by host (F147, DECISION-178)", () => {
  it("no entry other than the two host-conditioned ones carries HSTS", async () => {
    const entries = await loadHeaders("production");
    expect(hsts(entries)).toHaveLength(2);
    // The unconditioned site-wide entry must NOT set it: that was the bug (includeSubDomains everywhere).
    expect(siteEntry(entries).headers.map((h) => h.key)).not.toContain("Strict-Transport-Security");
  });

  it("a platform host keeps includeSubDomains; every other host gets max-age only", async () => {
    const [platform, custom] = hsts(await loadHeaders("production"));
    expect(platform!.has).toEqual([{ type: "host", value: expect.any(String) }]);
    expect(platform!.missing).toBeUndefined();
    expect(platform!.headers).toEqual([{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]);

    expect(custom!.missing).toEqual([{ type: "host", value: platform!.has![0]!.value }]);
    expect(custom!.has).toBeUndefined();
    expect(custom!.headers).toEqual([{ key: "Strict-Transport-Security", value: "max-age=63072000" }]);
    expect(custom!.headers[0]!.value).not.toContain("includeSubDomains");
  });

  it("the host pattern matches exactly the platform-host set (and nothing else)", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
    vi.stubEnv("NEXT_PUBLIC_PLATFORM_HOSTS", "app.example.invalid,www.example.invalid");
    const [platform] = hsts(await loadHeaders("production"));
    const re = new RegExp(`^${platform!.has![0]!.value}$`);
    for (const yes of [
      "app.example.invalid",
      "www.example.invalid",
      "presby-abc123.vercel.app",
      "a.b.vercel.app",
      "localhost",
      "127.0.0.1",
    ]) {
      expect(re.test(yes), yes).toBe(true);
    }
    for (const no of [
      "church-one.invalid",
      "example.invalid",
      "evil-app.example.invalid.attacker.invalid",
      "xapp.example.invalid",
      "app.example.invalid.evil.invalid",
      "vercel.app",
      "evilvercel.app",
      "x.vercel.app.evil.invalid",
      "",
    ]) {
      expect(re.test(no), no).toBe(false);
    }
  });

  it("in a production DEPLOYMENT loopback is not a platform host", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
    vi.stubEnv("NEXT_PUBLIC_PLATFORM_HOSTS", "app.example.invalid");
    vi.stubEnv("DOMAINS_PROVIDER", "");
    const [platform] = hsts(await loadHeaders("production"));
    const re = new RegExp(`^${platform!.has![0]!.value}$`);
    expect(re.test("localhost")).toBe(false);
    expect(re.test("127.0.0.1")).toBe(false);
    expect(re.test("app.example.invalid")).toBe(true);
  });
});

describe("next.config.ts redirects(): /orgs is scoped to platform hosts (F151)", () => {
  async function loadRedirects() {
    vi.resetModules();
    const mod = await import("../../../next.config");
    return (await mod.default.redirects!()) as Array<{
      source: string;
      destination: string;
      permanent?: boolean;
      has?: Array<{ type: string; value?: string }>;
    }>;
  }

  it("keeps the permanent /orgs -> /home redirect, but only for a platform host", async () => {
    const [orgs, ...rest] = await loadRedirects();
    expect(rest).toEqual([]);
    expect(orgs).toMatchObject({ source: "/orgs", destination: "/home", permanent: true });
    expect(orgs!.has).toEqual([{ type: "host", value: expect.any(String) }]);
    // Same pattern as the HSTS split: one definition of "platform host".
    const [platform] = hsts(await loadHeaders("production"));
    expect(orgs!.has![0]!.value).toBe(platform!.has![0]!.value);
  });
});

describe("next.config.ts: the production boot assertion (R2, T8)", () => {
  async function loadConfig(env: Record<string, string>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    return import("../../../next.config");
  }

  it("is silent outside a production deployment, whatever NODE_ENV says", async () => {
    await expect(loadConfig({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).resolves.toBeTruthy();
  });

  it("fails a production DEPLOYMENT with no https NEXT_PUBLIC_APP_URL, naming the variable", async () => {
    await expect(loadConfig({ VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "" })).rejects.toThrow(/NEXT_PUBLIC_APP_URL/);
    await expect(loadConfig({ VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "http://app.example.invalid" })).rejects.toThrow(/https/);
  });

  it("fails a production DEPLOYMENT carrying a dev/test fake", async () => {
    const base = { VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "https://app.example.invalid" };
    await expect(loadConfig({ ...base, DOMAINS_PROVIDER: "fake" })).rejects.toThrow(/DOMAINS_PROVIDER/);
    vi.unstubAllEnvs();
    await expect(loadConfig({ ...base, DOMAINS_DNS_PROVIDER: "fake" })).rejects.toThrow(/DOMAINS_DNS_PROVIDER/);
    vi.unstubAllEnvs();
    await expect(loadConfig({ ...base, DOMAINS_FAKE_STATE_FILE: "/tmp/x.json" })).rejects.toThrow(/DOMAINS_FAKE_STATE_FILE/);
    vi.unstubAllEnvs();
    await expect(loadConfig({ ...base, DOMAINS_ALLOW_RESERVED_TLDS: "1" })).rejects.toThrow(/DOMAINS_ALLOW_RESERVED_TLDS/);
  });

  it("passes a well-formed production DEPLOYMENT", async () => {
    await expect(
      loadConfig({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_APP_URL: "https://app.example.invalid",
        NEXT_PUBLIC_PLATFORM_HOSTS: "app.example.invalid,www.example.invalid",
      }),
    ).resolves.toBeTruthy();
  });
});
