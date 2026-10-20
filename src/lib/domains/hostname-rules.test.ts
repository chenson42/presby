/**
 * The G2 hostname rules and the A13 hostile-input table (Phase 3 "Rulings on
 * the [D] gaps"; adversarial row A13). Pure apart from `node:url`; the
 * environment is passed explicitly.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeClaimInput, type ClaimRefusal } from "./hostname-rules";
import { proofRecordName, proofRecordValue, proofValuesIn } from "./proof";

/** Reserved TLDs allowed, as the e2e/dev servers run; production asserts this unset. */
const DEV = { DOMAINS_ALLOW_RESERVED_TLDS: "1" } as const;
/** A production deployment's platform set. */
const PLATFORM = {
  VERCEL_ENV: "production",
  NEXT_PUBLIC_APP_URL: "https://www.platform.example",
  NEXT_PUBLIC_PLATFORM_HOSTS: "platform.example,www.platform.example",
} as const;

function ok(raw: string, env: Record<string, string | undefined> = DEV) {
  const result = normalizeClaimInput(raw, env);
  if (!result.ok) throw new Error(`expected ${JSON.stringify(raw)} to normalize, got ${result.reason}`);
  return result;
}

function refused(raw: string, reason: ClaimRefusal, env: Record<string, string | undefined> = DEV) {
  expect(normalizeClaimInput(raw, env)).toEqual({ ok: false, reason });
}

describe("normalization (accepted shapes)", () => {
  it.each([
    ["church-one.invalid", "church-one.invalid"],
    ["Church-One.INVALID", "church-one.invalid"],
    ["  church-one.invalid  ", "church-one.invalid"],
    ["https://church-one.invalid", "church-one.invalid"],
    ["HTTP://Church-One.invalid/", "church-one.invalid"],
    ["https://church-one.invalid/path/to?x=1#frag", "church-one.invalid"],
    ["church-one.invalid:8443", "church-one.invalid"],
    ["https://church-one.invalid:443/about", "church-one.invalid"],
    ["church-one.invalid.", "church-one.invalid"],
    ["church-one.invalid?utm=1", "church-one.invalid"],
    ["church-one.invalid#top", "church-one.invalid"],
    ["church-one.invalid\\path", "church-one.invalid"],
  ])("%j -> claim name %j", (raw, claimName) => {
    expect(ok(raw).claimName).toBe(claimName);
  });

  it("converts IDN to punycode and keeps the Unicode form for display", () => {
    const r = ok("münchen-kirche.invalid");
    expect(r.claimName).toBe("xn--mnchen-kirche-wob.invalid");
    expect(r.displayName).toBe("münchen-kirche.invalid");
  });

  it("accepts an already-punycoded name", () => {
    expect(ok("xn--mnchen-kirche-wob.invalid").displayName).toBe("münchen-kirche.invalid");
  });

  it("a name in a single non-Latin script is accepted", () => {
    expect(ok("пример-церковь.invalid").claimName.startsWith("xn--")).toBe(true);
  });
});

describe("the apex/www pair (G4)", () => {
  it("a typed apex offers the pair", () => {
    const r = ok("church-one.invalid");
    expect(r.pairable).toBe(true);
    expect(r.hostnames).toEqual(["church-one.invalid", "www.church-one.invalid"]);
  });

  it("a typed www. name is one row, and its proof covers only itself", () => {
    const r = ok("www.church-one.invalid");
    expect(r.pairable).toBe(false);
    expect(r.claimName).toBe("www.church-one.invalid");
    expect(r.hostnames).toEqual(["www.church-one.invalid"]);
  });

  it("a deeper name is one row", () => {
    const r = ok("blog.church-one.invalid");
    expect(r.pairable).toBe(false);
    expect(r.hostnames).toEqual(["blog.church-one.invalid"]);
  });

  it("a registry-label name under a country code is an apex (church.co.uk)", () => {
    const r = ok("church-one.co.uk");
    expect(r.pairable).toBe(true);
    expect(r.hostnames).toEqual(["church-one.co.uk", "www.church-one.co.uk"]);
  });

  it("a three-label name whose middle label is not a registry label is deeper", () => {
    expect(ok("blog.church-one.uk").pairable).toBe(false);
  });
});

describe("A13: hostile and degenerate input is refused", () => {
  it.each<[string, string, ClaimRefusal]>([
    ["empty", "", "empty"],
    ["whitespace only", "   \t ", "empty"],
    ["a scheme and nothing else", "https://", "empty"],
    ["only a path", "/about", "empty"],
    ["only a port", ":8080", "empty"],
    ["a lone dot", ".", "empty"],
    ["inner whitespace", "church one.invalid", "invalid_characters"],
    ["a tab inside", "church\tone.invalid", "invalid_characters"],
    ["a newline inside", "church-one.invalid\nevil.invalid", "invalid_characters"],
    ["a NUL byte", "church-one.invalid\u0000", "invalid_characters"],
    ["a zero-width space", "church​one.invalid", "invalid_characters"],
    ["a bidi override", "church‮one.invalid", "invalid_characters"],
    ["a non-breaking space", "church one.invalid", "invalid_characters"],
    ["a percent escape (a URL parser would decode it)", "ex%61mple.invalid", "invalid_characters"],
    ["a non-numeric port", "church-one.invalid:abc", "invalid_characters"],
    ["a doubled colon", "church-one.invalid::80", "invalid_format"],
    ["userinfo", "admin@church-one.invalid", "credentials"],
    ["userinfo with a password", "https://u:p@church-one.invalid", "credentials"],
    ["an email address", "pastor@church-one.invalid", "credentials"],
    ["a wildcard label", "*.church-one.invalid", "wildcard"],
    ["a bare wildcard", "*", "wildcard"],
    ["an empty label", "a..church-one.invalid", "invalid_format"],
    ["a leading dot", ".church-one.invalid", "invalid_format"],
    ["two trailing dots", "church-one.invalid..", "invalid_format"],
    ["a leading hyphen label", "-church.invalid", "invalid_format"],
    ["a trailing hyphen label", "church-.invalid", "invalid_format"],
    ["an underscore label", "_dmarc.church-one.invalid", "invalid_format"],
    ["malformed punycode", "xn--.church-one.invalid", "invalid_format"],
    ["a non-http scheme", "ftp://church-one.invalid", "invalid_characters"],
    ["javascript:", "javascript:alert(1)", "invalid_characters"],
    ["a label over 63 chars", `${"a".repeat(64)}.invalid`, "invalid_format"],
    ["a single label", "church", "too_few_labels"],
    ["a single label with a scheme", "https://church/", "too_few_labels"],
    ["an IPv4 literal", "203.0.113.9", "ip_address"],
    ["an IPv4 literal with a port", "203.0.113.9:8080", "ip_address"],
    ["a short IPv4 form", "10.1", "ip_address"],
    ["a decimal IPv4", "2130706433", "ip_address"],
    ["a hex IPv4", "0x7f.1", "ip_address"],
    ["an IPv6 literal", "[::1]", "invalid_characters"],
    ["localhost", "localhost", "too_few_labels"],
    ["a localhost subdomain", "church.localhost", "reserved"],
    ["a vercel.app host", "church-one.vercel.app", "reserved"],
    ["vercel.app itself", "vercel.app", "reserved"],
  ])("%s: %j", (_label, raw, reason) => {
    refused(raw, reason);
  });

  it("a 10,000-character input is refused before any parsing", () => {
    refused("a".repeat(10_000) + ".invalid", "too_long");
    refused("a.".repeat(5_000) + "invalid", "too_long");
  });

  it("a name over 253 characters is refused", () => {
    const long = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(20)}.invalid`;
    expect(long.length).toBeGreaterThan(253);
    refused(long, "too_long");
  });

  it("exactly 253 characters is the longest accepted name, held alone because its www. form would not fit", () => {
    const name = [63, 63, 63, 61].map((n, i) => "abcd"[i].repeat(n)).join(".");
    expect(name.length).toBe(253);
    const r = ok(name);
    expect(r.hostnames).toEqual([name]);
    expect(r.pairable).toBe(false);
    refused(`${name}x`, "too_long");
  });

  it("mixed-script labels (a Cyrillic lookalike inside a Latin label) are refused", () => {
    // "pаypal" with a Cyrillic а (U+0430) among Latin letters.
    refused("pаypal.invalid", "mixed_script");
    // Latin + Greek in one label.
    refused("aβc.invalid", "mixed_script");
  });

  it("one script per label is enough: a Cyrillic label under a Latin label is accepted", () => {
    ok("пример.church-one.invalid");
  });
});

describe("reserved names", () => {
  it("special-use TLDs are refused unless DOMAINS_ALLOW_RESERVED_TLDS=1", () => {
    for (const tld of ["invalid", "test", "example", "local", "internal", "onion", "arpa", "home", "lan"]) {
      refused(`church-one.${tld}`, "reserved", {});
    }
    expect(normalizeClaimInput("church-one.invalid", DEV).ok).toBe(true);
  });

  it("the allowance is exactly '1'", () => {
    refused("church-one.invalid", "reserved", { DOMAINS_ALLOW_RESERVED_TLDS: "true" });
  });

  it("our own platform hosts, and any subdomain of a platform apex, are refused", () => {
    const env = { ...PLATFORM, ...DEV };
    refused("platform.example", "reserved", env);
    refused("www.platform.example", "reserved", env);
    refused("sites.platform.example", "reserved", env);
    refused("a.b.platform.example", "reserved", env);
    refused("https://platform.example/site/x", "reserved", env);
  });

  it("a name that merely contains a platform name is accepted", () => {
    const env = { ...PLATFORM, ...DEV };
    ok("notplatform.example", env);
    ok("platform.example.church-one.invalid", env);
  });

  it("reserved names are refused on ANY input form of them", () => {
    const env = { ...PLATFORM, ...DEV };
    refused("PLATFORM.EXAMPLE.", "reserved", env);
    refused("platform.example:443", "reserved", env);
  });
});

describe("the TXT proof naming (proof.ts)", () => {
  it("the record sits at _presby-challenge.<claim name> with a presby-verify= value", () => {
    expect(proofRecordName("church-one.invalid")).toBe("_presby-challenge.church-one.invalid");
    expect(proofRecordValue("tok_en-123")).toBe("presby-verify=tok_en-123");
  });

  it("proofValuesIn keeps only presby-verify= values", () => {
    expect(proofValuesIn(["v=spf1 -all", "presby-verify=a", "google-site-verification=b", "presby-verify=c"])).toEqual([
      "presby-verify=a",
      "presby-verify=c",
    ]);
  });
});
