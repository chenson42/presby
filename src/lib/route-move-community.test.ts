import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The /o/<slug>/admin/members -> /o/<slug>/admin/community move
 * (docs/work-log/2026-10-22-founding-admin-directory.md, Batch M; DECISION-201).
 *
 * Two guards: the REAL `next.config.ts` `redirects()` carries a permanent,
 * platform-host-scoped redirect for the old paths (the `/orgs` precedent, F151),
 * and the old path string survives nowhere else in code, so a stale link, a
 * `revalidatePath` or a `callbackUrl` cannot creep back in.
 */

type RedirectEntry = {
  source: string;
  destination: string;
  permanent?: boolean;
  has?: Array<{ type: string; value?: string }>;
};

async function loadRedirects(): Promise<RedirectEntry[]> {
  vi.resetModules();
  const mod = await import("../../next.config");
  return (await mod.default.redirects!()) as RedirectEntry[];
}

afterEach(() => vi.resetModules());

describe("next.config.ts redirects(): the /admin/members -> /admin/community move", () => {
  it("is a permanent redirect carrying the sub-path, scoped to platform hosts", async () => {
    const entry = (await loadRedirects()).find((r) => r.source === "/o/:slug/admin/members/:path*");
    expect(entry).toBeDefined();
    expect(entry!.destination).toBe("/o/:slug/admin/community/:path*");
    expect(entry!.permanent).toBe(true);
    // F151: unscoped, `redirects()` would answer on a church's own domain.
    expect(entry!.has).toEqual([{ type: "host", value: expect.any(String) }]);
    const orgs = (await loadRedirects()).find((r) => r.source === "/orgs")!;
    expect(entry!.has![0]!.value).toBe(orgs.has![0]!.value); // one definition of "platform host"
  });

  it("keeps the /orgs redirect beside it", async () => {
    const entry = (await loadRedirects()).find((r) => r.source === "/orgs");
    expect(entry?.destination).toBe("/home");
  });
});

describe("the retired route string", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const SCAN_DIRS = ["src", "scripts", "e2e"];
  const SKIP_DIRS = new Set(["node_modules", ".next"]);
  const OLD = "admin/members";
  // Files allowed to name the old path: this test, and the redirect-list assertion beside the
  // /orgs one. (next.config.ts is root-level, outside SCAN_DIRS, and has its own check below.)
  const ALLOWED = new Set(["src/lib/route-move-community.test.ts", "src/lib/giving/csp.test.ts"]);

  function* walk(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) yield* walk(full);
      else if (/\.(tsx?|mjs|js|sql|md)$/.test(name)) yield full;
    }
  }

  it("appears in no source, script or e2e file except the allowlist", () => {
    const offenders: string[] = [];
    for (const d of SCAN_DIRS) {
      for (const file of walk(path.join(ROOT, d))) {
        const rel = path.relative(ROOT, file);
        if (ALLOWED.has(rel)) continue;
        if (readFileSync(file, "utf8").includes(OLD)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("appears in next.config.ts only on the redirect's source line", () => {
    const lines = readFileSync(path.join(ROOT, "next.config.ts"), "utf8")
      .split("\n")
      .filter((l) => l.includes(OLD));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('source: "/o/:slug/admin/members/:path*"');
  });

  it("the old route directory no longer exists", () => {
    expect(() => statSync(path.join(ROOT, "src/app/(org)/o/[slug]/admin/members"))).toThrow();
  });
});
