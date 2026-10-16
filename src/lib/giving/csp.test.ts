import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The enforced Content-Security-Policy on the online-giving routes
 * (docs/work-log/2026-10-15-online-giving.md, Batch 4; R7 / G30 / SAQ-A). Reads
 * the REAL `next.config.ts` `headers()`. `e2e/security-headers.spec.ts` proves
 * the same thing over HTTP against a running server; this is the fast guard.
 */

type HeaderEntry = { source: string; headers: Array<{ key: string; value: string }> };

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

const GIVE_SOURCES = ["/site/:slug/give/:path*", "/o/:slug/giving/give/:path*"];

describe("next.config.ts headers(): the enforced CSP on the give routes", () => {
  it("has the site-wide entry plus one enforced entry per give route, and no other", async () => {
    const entries = await loadHeaders("production");
    expect(entries.map((e) => e.source)).toEqual(["/(.*)", ...GIVE_SOURCES]);
  });

  it("the site-wide entry stays REPORT-ONLY and carries no enforced policy", async () => {
    const [site] = await loadHeaders("production");
    const keys = site!.headers.map((h) => h.key);
    expect(keys).toContain("Content-Security-Policy-Report-Only");
    expect(keys).not.toContain("Content-Security-Policy");
  });

  it.each(["production", "development"])(
    "[%s] the give entries carry ONLY the enforced header, and its value is the report-only string, byte for byte",
    async (mode) => {
      const entries = await loadHeaders(mode);
      const reportOnly = entries[0]!.headers.find((h) => h.key === "Content-Security-Policy-Report-Only")!.value;
      for (const entry of entries.slice(1)) {
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
    const csp = entries[1]!.headers[0]!.value;
    const directive = (name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
    expect(directive("form-action")).toBe("form-action 'self'");
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
    expect(directive("default-src")).toBe("default-src 'self'");
    expect(csp).not.toMatch(/(^|[\s;])\*([\s;]|$)/);
    expect(csp).not.toContain("http:");
  });

  it("'unsafe-eval' exists ONLY in development (React's dev build needs it); a production build never ships it", async () => {
    const production = (await loadHeaders("production"))[1]!.headers[0]!.value;
    const development = (await loadHeaders("development"))[1]!.headers[0]!.value;
    expect(production).not.toContain("unsafe-eval");
    expect(development).toContain("'unsafe-eval'");
    expect(development.replace(" 'unsafe-eval'", "")).toBe(production);
  });
});
