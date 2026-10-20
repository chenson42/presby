import { test, expect } from "@playwright/test";

// Header assertions run against the dev server (npm run dev).
// HSTS is ignored by browsers on HTTP but Next.js still emits the header — the assertion
// checks header presence and value string, not browser enforcement.
// CSP-Report-Only connect-src violation noise (HMR WebSocket) is expected in dev devtools
// and does not affect these assertions.

test.describe("Security headers", () => {
  test("Content-Security-Policy-Report-Only is present and non-empty", async ({
    request,
  }) => {
    const response = await request.get("/");
    const csp = response.headers()["content-security-policy-report-only"];
    expect(csp).toBeTruthy();
    expect(csp.length).toBeGreaterThan(0);
  });

  test("Strict-Transport-Security does not include preload", async ({
    request,
  }) => {
    const response = await request.get("/");
    const hsts = response.headers()["strict-transport-security"];
    expect(hsts).toBeTruthy();
    expect(hsts).not.toContain("preload");
  });

  // -------------------------------------------------------------------------
  // Online giving (Batch 4): an ENFORCED Content-Security-Policy on the give
  // routes only, the same string as the report-only policy, no Stripe origin.
  // A donor reaches Checkout by redirect, so nothing Stripe-shaped is ever
  // loaded on a presby page (docs/work-log/2026-10-15-online-giving.md, R7/G30).
  // The routes need not render a page for the header to be there (a 404 and a
  // 307 carry it too); these assert the header, not the page.
  // -------------------------------------------------------------------------
  test.describe("enforced CSP on the online-giving routes", () => {
    const ENFORCED = "content-security-policy";
    const REPORT_ONLY = "content-security-policy-report-only";

    const GIVE_PATHS = [
      "/site/alder-creek/give",
      "/site/alder-creek/give/return",
      "/site/alder-creek/give/return?session_id=cs_test_abcdefghij",
      "/site/no-such-congregation/give",
      "/o/alder-creek/giving/give",
      "/o/alder-creek/giving/give/return",
    ];

    const NOT_GIVE_PATHS = [
      "/",
      "/signin",
      "/site/alder-creek",
      "/site/alder-creek/about",
      "/site/alder-creek/about/give",
      "/site/alder-creek/giving",
      "/site/alder-creek/giver",
      "/site/alder-creek/give-now",
      "/o/alder-creek/giving",
      "/o/alder-creek/giving/giveaway",
      "/o/alder-creek/admin/giving",
    ];

    for (const path of GIVE_PATHS) {
      test(`${path} carries an enforced policy identical to the report-only one`, async ({ request }) => {
        const response = await request.get(path, { maxRedirects: 0 });
        const headers = response.headers();
        expect(headers[ENFORCED], `${path} -> ${response.status()}`).toBeTruthy();
        expect(headers[ENFORCED]).toBe(headers[REPORT_ONLY]);
        // The report-only header is still there beside it, so a violation is blocked AND reported.
        expect(headers[REPORT_ONLY]).toBeTruthy();
      });
    }

    for (const path of NOT_GIVE_PATHS) {
      test(`${path} does NOT carry an enforced policy`, async ({ request }) => {
        const response = await request.get(path, { maxRedirects: 0 });
        const headers = response.headers();
        expect(headers[ENFORCED], `${path} -> ${response.status()}`).toBeUndefined();
        // ...and keeps the existing report-only policy.
        expect(headers[REPORT_ONLY]).toBeTruthy();
      });
    }

    test("the enforced policy keeps form-action 'self' and frame-ancestors 'none' and names no Stripe origin", async ({ request }) => {
      const response = await request.get("/site/alder-creek/give", { maxRedirects: 0 });
      const csp = response.headers()[ENFORCED]!;
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("default-src 'self'");
      expect(csp.toLowerCase()).not.toContain("stripe");
      for (const [name, value] of Object.entries(response.headers())) {
        if (name === ENFORCED || name === REPORT_ONLY) continue;
        expect(`${name}: ${value}`.toLowerCase(), "no Stripe origin in any other response header").not.toContain("stripe.com");
      }
    });
  });
});
