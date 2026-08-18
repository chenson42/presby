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
});
