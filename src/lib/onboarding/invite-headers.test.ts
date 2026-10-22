/**
 * The `/invite` response headers (R6, F156): Referrer-Policy no-referrer,
 * Cache-Control no-store, X-Robots-Tag noindex. They live in next.config.ts
 * `headers()`, scoped to platform hosts and placed AFTER the catch-all
 * security-header entry (Next merges matching entries in order; the later
 * value for a key wins).
 */
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

type HeaderRule = {
  source: string;
  has?: Array<{ type: string; value?: string }>;
  missing?: Array<{ type: string; value?: string }>;
  headers: Array<{ key: string; value: string }>;
};

async function rules(): Promise<HeaderRule[]> {
  return (await nextConfig.headers!()) as HeaderRule[];
}

describe("next.config headers() for the invitation routes", () => {
  it.each(["/invite", "/invite/accepted"])("%s gets no-referrer, no-store and noindex, on platform hosts only", async (source) => {
    const rule = (await rules()).find((r) => r.source === source);
    expect(rule, `a headers() rule for ${source}`).toBeDefined();
    expect(rule!.headers).toEqual([
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "no-store" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ]);
    // Scoped to the platform-host set (a custom host never serves /invite).
    expect(rule!.has).toEqual([{ type: "host", value: expect.any(String) }]);
    expect(rule!.missing).toBeUndefined();
  });

  it("is exact-path: there is no wildcard rule for /invite", async () => {
    const sources = (await rules()).map((r) => r.source);
    expect(sources.filter((s) => s.startsWith("/invite")).sort()).toEqual(["/invite", "/invite/accepted"]);
  });

  it("comes AFTER the catch-all security-header rule so its Referrer-Policy wins", async () => {
    const all = await rules();
    const catchAll = all.findIndex((r) => r.source === "/(.*)" && r.headers.some((h) => h.key === "Referrer-Policy"));
    const invite = all.findIndex((r) => r.source === "/invite");
    expect(catchAll).toBeGreaterThanOrEqual(0);
    expect(invite).toBeGreaterThan(catchAll);
  });
});
