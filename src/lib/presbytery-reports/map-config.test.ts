/**
 * The map's configuration seam and the one CSP host it adds (DECISION-343).
 * `loadHeaders` follows `src/lib/giving/csp.test.ts`: it reads the REAL
 * `next.config.ts` `headers()`, so the literal there and `MAP_TILE_ORIGIN`
 * cannot drift apart.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MAP_STYLE_PATH, MAP_TILE_ORIGIN, mapTileConfig } from "./map-config";

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

const directive = (policy: string, name: string) =>
  policy
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));

describe("mapTileConfig", () => {
  const FAKE = "fake-key-value_123"; // leak-ok: a made-up value shaped like a map key

  it("is null with no key, a blank key, or a key of the wrong shape", () => {
    expect(mapTileConfig({})).toBeNull();
    expect(mapTileConfig({ NEXT_PUBLIC_MAPTILER_KEY: "" })).toBeNull();
    expect(mapTileConfig({ NEXT_PUBLIC_MAPTILER_KEY: "   " })).toBeNull();
    expect(mapTileConfig({ NEXT_PUBLIC_MAPTILER_KEY: "short" })).toBeNull();
    expect(mapTileConfig({ NEXT_PUBLIC_MAPTILER_KEY: "has space in it" })).toBeNull();
    expect(mapTileConfig({ NEXT_PUBLIC_MAPTILER_KEY: "bad&key=injected1234" })).toBeNull();
    expect(mapTileConfig({ NEXT_PUBLIC_MAPTILER_KEY: "x".repeat(129) })).toBeNull();
    expect(mapTileConfig({ NEXT_PUBLIC_MAPTILER_KEY: "a/b?c=dddddddd" })).toBeNull();
  });

  it("builds a Leaflet raster template on the one origin, carrying the key and nothing else", () => {
    const config = mapTileConfig({ NEXT_PUBLIC_MAPTILER_KEY: `  ${FAKE}  ` });
    expect(config).not.toBeNull();
    const url = config!.tileUrl;
    expect(url).toBe(`${MAP_TILE_ORIGIN}${MAP_STYLE_PATH}?key=${FAKE}`);
    expect(url.startsWith(`${MAP_TILE_ORIGIN}/`)).toBe(true);
    expect(url).toContain("{z}/{x}/{y}");
    expect(url).not.toContain("{s}");
    expect(url.split("?")[1]).toBe(`key=${FAKE}`);
  });

  it("reads the env it is given, not process.env", () => {
    vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", FAKE);
    expect(mapTileConfig({})).toBeNull();
    expect(mapTileConfig()).not.toBeNull();
  });

  it("is a 256-pixel PNG path (the documented Leaflet one)", () => {
    expect(MAP_STYLE_PATH).toBe("/maps/streets-v4/256/{z}/{x}/{y}.png");
    expect(MAP_TILE_ORIGIN).toBe("https://api.maptiler.com");
  });
});

describe("next.config.ts headers(): the one map host", () => {
  const POLICY_IMG =
    "img-src 'self' data: https://lh3.googleusercontent.com https://api.maptiler.com";

  it.each(["production", "development"])("img-src equals the line pinned here (%s)", async (env) => {
    const entries = await loadHeaders(env);
    const reportOnly = entries
      .flatMap((e) => e.headers)
      .find((h) => h.key === "Content-Security-Policy-Report-Only")!.value;
    expect(directive(reportOnly, "img-src")).toBe(POLICY_IMG);
    expect(directive(reportOnly, "connect-src")).toBe("connect-src 'self'");
    expect(directive(reportOnly, "img-src")).toContain(MAP_TILE_ORIGIN);
    expect(directive(reportOnly, "img-src")).not.toContain("*");
  });

  it("the enforced give-route policy is the same string (so the map host is also an allowed image origin there)", async () => {
    const entries = await loadHeaders("production");
    const enforced = entries
      .flatMap((e) => e.headers)
      .filter((h) => h.key === "Content-Security-Policy")
      .map((h) => h.value);
    expect(enforced.length).toBeGreaterThan(0);
    for (const policy of enforced) {
      expect(directive(policy, "img-src")).toBe(POLICY_IMG);
      expect(directive(policy, "connect-src")).toBe("connect-src 'self'");
    }
  });

  it("adds no other host anywhere in the policy than the five it already carried plus the map host", async () => {
    const entries = await loadHeaders("production");
    const policy = entries
      .flatMap((e) => e.headers)
      .find((h) => h.key === "Content-Security-Policy-Report-Only")!.value;
    const hosts = [...policy.matchAll(/https:\/\/[a-z0-9.-]+/g)].map((m) => m[0]).sort();
    expect(hosts).toEqual(
      [
        "https://api.maptiler.com",
        "https://challenges.cloudflare.com",
        "https://challenges.cloudflare.com",
        "https://lh3.googleusercontent.com",
        "https://player.vimeo.com",
        "https://www.youtube-nocookie.com",
      ].sort(),
    );
  });

  it("keeps the site-wide Referrer-Policy at strict-origin-when-cross-origin (the tile request needs the origin)", async () => {
    const entries = await loadHeaders("production");
    const catchAll = entries.filter((e) => e.source === "/(.*)");
    const values = catchAll.flatMap((e) => e.headers).filter((h) => h.key === "Referrer-Policy");
    expect(values.map((h) => h.value)).toEqual(["strict-origin-when-cross-origin"]);
  });
});
