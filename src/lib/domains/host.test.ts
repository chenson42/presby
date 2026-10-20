/**
 * host.ts: classification, the platform-host set, the site key and the boot
 * assertion (Phase 3 API Contract sections 1, 2 and 3; Phase 2 R1-R4, T8,
 * T16). Pure, no database. Environment is passed explicitly wherever the
 * function takes it, so these tests never touch process.env except where the
 * memoized default is the thing under test.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertPlatformHostConfig,
  isIpLiteral,
  isPlatformHost,
  isProductionDeployment,
  normalizeHost,
  parseSiteKey,
  platformHosts,
  platformOrigin,
  requestHost,
  siteKeyRewritePath,
} from "./host";

const PROD = { VERCEL_ENV: "production" } as const;
const headers = (record: Record<string, string>) => ({
  get: (name: string) => record[name.toLowerCase()] ?? null,
});

describe("normalizeHost", () => {
  it.each([
    ["Church-One.INVALID", "church-one.invalid"],
    ["church-one.invalid:443", "church-one.invalid"],
    ["church-one.invalid.", "church-one.invalid"],
    ["  church-one.invalid  ", "church-one.invalid"],
    ["WWW.Church-One.Invalid:8080", "www.church-one.invalid"],
    ["a.b", "a.b"],
    ["xn--80ak6aa92e.invalid", "xn--80ak6aa92e.invalid"],
  ])("normalizes %j to %j", (raw, expected) => {
    expect(normalizeHost(raw, PROD)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    ".",
    "a..b.invalid",
    "-a.invalid",
    "a-.invalid",
    "a_b.invalid",
    "a b.invalid",
    "church.invalid:",
    "church.invalid:abc",
    "church.invalid:99999999",
    "a:b:c",
    "http://church.invalid",
    "church.invalid/",
    "church.invalid?x",
    "user@church.invalid",
    "church.invalid.\u0000",
    "münchen.invalid",
    `${"a".repeat(64)}.invalid`,
    `${"a.".repeat(130)}invalid`,
  ])("refuses %j", (raw) => {
    expect(normalizeHost(raw, PROD)).toBeNull();
  });

  it("refuses null and undefined", () => {
    expect(normalizeHost(null, PROD)).toBeNull();
    expect(normalizeHost(undefined, PROD)).toBeNull();
  });

  it("strips exactly one trailing dot", () => {
    expect(normalizeHost("church.invalid..", PROD)).toBeNull();
  });

  it("refuses an IP literal in a production deployment and admits it outside one", () => {
    expect(normalizeHost("203.0.113.9", PROD)).toBeNull();
    expect(normalizeHost("203.0.113.9:3000", PROD)).toBeNull();
    expect(normalizeHost("203.0.113.9", {})).toBe("203.0.113.9");
    expect(normalizeHost("127.0.0.1:3000", {})).toBe("127.0.0.1");
    expect(normalizeHost("[::1]:3000", {})).toBe("[::1]");
    expect(normalizeHost("[::1]:3000", PROD)).toBeNull();
    expect(normalizeHost("[2001:db8::1]", {})).toBeNull();
  });
});

describe("isIpLiteral", () => {
  it.each(["1.2.3.4", "0.0.0.0", "10.0.0", "2130706433"])("%s is", (h) => {
    expect(isIpLiteral(h)).toBe(true);
  });
  it.each(["church.invalid", "a1.b2", "xn--9.invalid"])("%s is not", (h) => {
    expect(isIpLiteral(h)).toBe(false);
  });
});

describe("requestHost reads ONLY the Host header (R3, A2)", () => {
  it("returns the normalized Host", () => {
    expect(requestHost(headers({ host: "Church-One.invalid:3000" }), PROD)).toBe(
      "church-one.invalid",
    );
  });

  it("ignores x-forwarded-host, forwarded and x-original-host entirely", () => {
    const spoofed = headers({
      host: "church-one.invalid",
      "x-forwarded-host": "presbyportal.invalid",
      forwarded: "host=presbyportal.invalid;proto=https",
      "x-original-host": "presbyportal.invalid",
    });
    expect(requestHost(spoofed, PROD)).toBe("church-one.invalid");
  });

  it("a forwarded header alone, with no Host, yields null (it is never a fallback)", () => {
    const only = headers({
      "x-forwarded-host": "church-one.invalid",
      forwarded: "host=church-one.invalid",
    });
    expect(requestHost(only, PROD)).toBeNull();
  });

  it("a malformed Host is null whatever the forwarded headers say", () => {
    expect(
      requestHost(
        headers({ host: "bad host", "x-forwarded-host": "church-one.invalid" }),
        PROD,
      ),
    ).toBeNull();
  });
});

describe("the platform-host set (R2)", () => {
  const BASE = {
    NEXT_PUBLIC_APP_URL: "https://www.platform.invalid",
    NEXT_PUBLIC_PLATFORM_HOSTS: "platform.invalid, www.platform.invalid, bad host",
  };

  it("is the host of NEXT_PUBLIC_APP_URL plus NEXT_PUBLIC_PLATFORM_HOSTS, skipping an invalid entry", () => {
    const set = platformHosts({ ...BASE, ...PROD });
    expect([...set].sort()).toEqual(["platform.invalid", "www.platform.invalid"]);
  });

  it("adds loopback and DEV_ALLOWED_ORIGINS outside a production deployment only", () => {
    const dev = platformHosts({ ...BASE, DEV_ALLOWED_ORIGINS: "192.168.1.5, phone.lan.invalid" });
    expect(dev.has("localhost")).toBe(true);
    expect(dev.has("127.0.0.1")).toBe(true);
    expect(dev.has("[::1]")).toBe(true);
    expect(dev.has("192.168.1.5")).toBe(true);
    expect(dev.has("phone.lan.invalid")).toBe(true);

    const prod = platformHosts({ ...BASE, ...PROD, DEV_ALLOWED_ORIGINS: "192.168.1.5" });
    expect(prod.has("localhost")).toBe(false);
    expect(prod.has("192.168.1.5")).toBe(false);
  });

  it("never reads VERCEL_PROJECT_PRODUCTION_URL (F148)", () => {
    const set = platformHosts({
      ...BASE,
      ...PROD,
      VERCEL_PROJECT_PRODUCTION_URL: "short-church.invalid",
    });
    expect(set.has("short-church.invalid")).toBe(false);
    expect(isPlatformHost("short-church.invalid", { ...BASE, ...PROD, VERCEL_PROJECT_PRODUCTION_URL: "short-church.invalid" })).toBe(false);
  });

  it("isPlatformHost: set members, any *.vercel.app, and *.trycloudflare.com outside production only", () => {
    const prod = { ...BASE, ...PROD };
    expect(isPlatformHost("www.platform.invalid", prod)).toBe(true);
    expect(isPlatformHost("presby-git-x-team.vercel.app", prod)).toBe(true);
    expect(isPlatformHost("church-one.invalid", prod)).toBe(false);
    expect(isPlatformHost("abc.trycloudflare.com", prod)).toBe(false);
    expect(isPlatformHost("abc.trycloudflare.com", BASE)).toBe(true);
    expect(isPlatformHost("localhost", prod)).toBe(false);
    expect(isPlatformHost("localhost", BASE)).toBe(true);
  });

  it("a host that merely ends with a platform host is NOT a platform host", () => {
    const prod = { ...BASE, ...PROD };
    expect(isPlatformHost("evil-www.platform.invalid", prod)).toBe(false);
    expect(isPlatformHost("www.platform.invalid.church.invalid", prod)).toBe(false);
    expect(isPlatformHost("notvercel.app", prod)).toBe(false);
  });

  describe("memoization on process.env", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("recomputes when a relevant variable changes", () => {
      vi.stubEnv("VERCEL_ENV", "production");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://one.invalid");
      vi.stubEnv("NEXT_PUBLIC_PLATFORM_HOSTS", "");
      expect([...platformHosts()]).toEqual(["one.invalid"]);
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://two.invalid");
      expect([...platformHosts()]).toEqual(["two.invalid"]);
    });
  });
});

describe("platformOrigin keeps givingOrigin's rule verbatim (T16)", () => {
  it("returns the bare https origin, dropping a path", () => {
    expect(
      platformOrigin({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://www.example.invalid/some/path/" }),
    ).toBe("https://www.example.invalid");
  });
  it("is null in production for unset, http and credentials", () => {
    expect(platformOrigin({ NODE_ENV: "production" })).toBeNull();
    expect(platformOrigin({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://x.invalid" })).toBeNull();
    expect(platformOrigin({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://u:p@x.invalid" })).toBeNull();
    expect(platformOrigin({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "javascript:alert(1)" })).toBeNull();
  });
  it("outside production falls back to localhost and admits http", () => {
    expect(platformOrigin({ NODE_ENV: "development" })).toBe("http://localhost:3000");
    expect(platformOrigin({ NODE_ENV: "test", NEXT_PUBLIC_APP_URL: "http://localhost:3100" })).toBe(
      "http://localhost:3100",
    );
  });
  it("takes no request input", () => {
    expect(platformOrigin.length).toBeLessThanOrEqual(1);
  });
});

describe("the site key (R1)", () => {
  it("no dot is a slug; a normalized dotted value is a host", () => {
    expect(parseSiteKey("alder-creek")).toEqual({ kind: "slug", slug: "alder-creek" });
    expect(parseSiteKey("church-one.invalid")).toEqual({ kind: "host", host: "church-one.invalid" });
    expect(parseSiteKey("www.church-one.invalid")).toEqual({
      kind: "host",
      host: "www.church-one.invalid",
    });
  });

  it.each([
    "",
    "Alder-Creek",
    "alder_creek",
    "-alder",
    "alder-",
    "a b",
    "Church-One.invalid",
    "church-one.invalid:3000",
    "church-one.invalid.",
    "church%2Eone.invalid",
    ".invalid",
    "a..invalid",
    "church-one.invalid/x",
    "%2e",
  ])("%j is invalid", (param) => {
    expect(parseSiteKey(param)).toEqual({ kind: "invalid" });
  });

  it("the rewrite path is /site/<host><pathname>, with no doubled slash for the root", () => {
    expect(siteKeyRewritePath("church-one.invalid", "/")).toBe("/site/church-one.invalid");
    expect(siteKeyRewritePath("church-one.invalid", "/about")).toBe("/site/church-one.invalid/about");
    expect(siteKeyRewritePath("church-one.invalid", "/api/auth/csrf")).toBe(
      "/site/church-one.invalid/api/auth/csrf",
    );
  });
});

describe("assertPlatformHostConfig (R2, T8)", () => {
  const GOOD = {
    NEXT_PUBLIC_APP_URL: "https://www.platform.invalid",
    NEXT_PUBLIC_PLATFORM_HOSTS: "platform.invalid,www.platform.invalid",
  };

  it("passes a sound production configuration", () => {
    expect(() => assertPlatformHostConfig(GOOD)).not.toThrow();
  });

  it.each<[string, Record<string, string | undefined>, RegExp]>([
    ["a missing app url", { ...GOOD, NEXT_PUBLIC_APP_URL: undefined }, /NEXT_PUBLIC_APP_URL must be set/],
    ["a blank app url", { ...GOOD, NEXT_PUBLIC_APP_URL: "  " }, /NEXT_PUBLIC_APP_URL must be set/],
    ["a malformed app url", { ...GOOD, NEXT_PUBLIC_APP_URL: "not a url" }, /NEXT_PUBLIC_APP_URL is not a valid/],
    ["an http app url", { ...GOOD, NEXT_PUBLIC_APP_URL: "http://www.platform.invalid" }, /must be an https/],
    [
      "a platform-host entry that is not a hostname",
      { ...GOOD, NEXT_PUBLIC_PLATFORM_HOSTS: "platform.invalid,bad host" },
      /NEXT_PUBLIC_PLATFORM_HOSTS entry "bad host"/,
    ],
    [
      "an IP-literal platform-host entry",
      { ...GOOD, NEXT_PUBLIC_PLATFORM_HOSTS: "203.0.113.9" },
      /NEXT_PUBLIC_PLATFORM_HOSTS entry "203.0.113.9"/,
    ],
    ["the reserved-TLD allowance", { ...GOOD, DOMAINS_ALLOW_RESERVED_TLDS: "1" }, /DOMAINS_ALLOW_RESERVED_TLDS/],
    ["the fake DNS provider", { ...GOOD, DOMAINS_DNS_PROVIDER: "fake" }, /DOMAINS_DNS_PROVIDER=fake/],
    ["the fake hosting provider", { ...GOOD, DOMAINS_PROVIDER: "fake" }, /DOMAINS_PROVIDER=fake/],
    ["a fake state file", { ...GOOD, DOMAINS_FAKE_STATE_FILE: ".tmp/x.json" }, /DOMAINS_FAKE_STATE_FILE/],
  ])("throws for %s, naming the variable", (_label, env, pattern) => {
    expect(() => assertPlatformHostConfig(env)).toThrow(pattern);
  });

  it("isProductionDeployment is VERCEL_ENV only, not NODE_ENV", () => {
    expect(isProductionDeployment({ NODE_ENV: "production" })).toBe(false);
    expect(isProductionDeployment({ VERCEL_ENV: "production" })).toBe(true);
    expect(isProductionDeployment({ VERCEL_ENV: "preview" })).toBe(false);
  });
});

describe("F148: VERCEL_PROJECT_PRODUCTION_URL is never read", () => {
  const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
  const NEEDLE = ["VERCEL", "PROJECT", "PRODUCTION", "URL"].join("_");

  function files(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...files(full));
      else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(full);
    }
    return out;
  }

  /** Source with block and line comments removed, so prose cannot trip the scan. */
  function code(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("no non-test source file reads it outside a comment", () => {
    const candidates = [...files(join(ROOT, "src")), join(ROOT, "next.config.ts")].filter(
      (f) => !/\.test\.tsx?$/.test(f),
    );
    expect(candidates.length).toBeGreaterThan(200);
    const offenders = candidates
      .filter((f) => code(readFileSync(f, "utf8")).includes(NEEDLE))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("the comment stripper really strips (control)", () => {
    expect(code(`// ${NEEDLE}\n/* ${NEEDLE} */\nconst x = 1;`)).not.toContain(NEEDLE);
    expect(code(`const x = process.env.${NEEDLE};`)).toContain(NEEDLE);
  });
});
