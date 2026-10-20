import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSiteUrls, slugSitePath } from "./site-urls";

const PLATFORM = "https://app.example.invalid";
const slugUrls = () => buildSiteUrls({ mode: "slug", slug: "alder-creek", platformOrigin: PLATFORM });
const hostUrls = (host = "www.church-one.invalid") =>
  buildSiteUrls({ mode: "host", host, slug: "alder-creek", platformOrigin: PLATFORM });

describe("slug mode: today's /site/<slug>/... shapes on the platform origin", () => {
  it("builds every method", () => {
    const u = slugUrls();
    expect(u.mode).toBe("slug");
    expect(u.origin).toBe(PLATFORM);
    expect(u.home()).toBe("/site/alder-creek");
    expect(u.page("/")).toBe("/site/alder-creek");
    expect(u.page("/about")).toBe("/site/alder-creek/about");
    expect(u.page("/ministries/food-pantry")).toBe("/site/alder-creek/ministries/food-pantry");
    expect(u.asset("blob-key-1")).toBe("/site/alder-creek/assets/blob-key-1");
    expect(u.sitemap()).toBe("/site/alder-creek/sitemap.xml");
    expect(u.give()).toBe("/site/alder-creek/give");
    expect(u.giveReturn("cs_test_a1")).toBe("/site/alder-creek/give/return?session_id=cs_test_a1");
    expect(u.canonical("/about")).toBe(`${PLATFORM}/site/alder-creek/about`);
    expect(u.canonical("/")).toBe(`${PLATFORM}/site/alder-creek`);
    expect(u.portal()).toBe(`${PLATFORM}/o/alder-creek`);
  });

  it("tolerates a trailing slash on the platform origin", () => {
    const u = buildSiteUrls({ mode: "slug", slug: "alder-creek", platformOrigin: `${PLATFORM}/` });
    expect(u.origin).toBe(PLATFORM);
    expect(u.canonical("/about")).toBe(`${PLATFORM}/site/alder-creek/about`);
  });
});

describe("host mode: CLEAN paths on the canonical host (no /site/, no slug)", () => {
  it("builds every method", () => {
    const u = hostUrls();
    expect(u.mode).toBe("host");
    expect(u.origin).toBe("https://www.church-one.invalid");
    expect(u.home()).toBe("/");
    expect(u.page("/")).toBe("/");
    expect(u.page("/about")).toBe("/about");
    expect(u.page("/ministries/food-pantry")).toBe("/ministries/food-pantry");
    expect(u.asset("blob-key-1")).toBe("/assets/blob-key-1");
    expect(u.sitemap()).toBe("/sitemap.xml");
    expect(u.give()).toBe("/give");
    expect(u.giveReturn("cs_test_a1")).toBe("/give/return?session_id=cs_test_a1");
    expect(u.canonical("/about")).toBe("https://www.church-one.invalid/about");
    expect(u.canonical("/")).toBe("https://www.church-one.invalid/");
  });

  it("names the slug in exactly one place: the absolute portal link on the PLATFORM host (G5)", () => {
    const u = hostUrls();
    expect(u.portal()).toBe(`${PLATFORM}/o/alder-creek`);
    const sameHost = [
      u.home(),
      u.page("/"),
      u.page("/about"),
      u.asset("k"),
      u.sitemap(),
      u.give(),
      u.giveReturn("cs_x"),
      u.canonical("/about"),
      u.origin,
    ];
    for (const url of sameHost) {
      expect(url, url).not.toContain("alder-creek");
      expect(url, url).not.toContain("/site/");
      expect(url, url).not.toContain("app.example.invalid");
    }
  });

  it("every absolute URL is https on the given host; nothing is derived from anything but the arguments", () => {
    const u = hostUrls("church-one.invalid");
    expect(u.origin).toBe("https://church-one.invalid");
    expect(u.canonical("/x")).toBe("https://church-one.invalid/x");
  });
});

describe("path and key handling", () => {
  it("normalizes a bundle path to exactly one leading slash", () => {
    for (const u of [slugUrls(), hostUrls()]) {
      expect(u.page("about")).toBe(u.page("/about"));
      expect(u.page("")).toBe(u.page("/"));
    }
  });

  it("percent-encodes a blob key and a session id: nothing can add a path segment or a parameter", () => {
    const h = hostUrls();
    expect(h.asset("a/b?c#d")).toBe("/assets/a%2Fb%3Fc%23d");
    expect(h.giveReturn("cs_x&session_id=evil")).toBe("/give/return?session_id=cs_x%26session_id%3Devil");
    const s = slugUrls();
    expect(s.asset("../../x")).toBe("/site/alder-creek/assets/..%2F..%2Fx");
  });

  it("throws on a slug or host that is not one (a programming error, never user input)", () => {
    expect(() => buildSiteUrls({ mode: "slug", slug: "Bad Slug", platformOrigin: PLATFORM })).toThrow();
    expect(() => buildSiteUrls({ mode: "slug", slug: "a.b", platformOrigin: PLATFORM })).toThrow();
    expect(() => buildSiteUrls({ mode: "host", host: "nodot", slug: "alder-creek", platformOrigin: PLATFORM })).toThrow();
    expect(() => buildSiteUrls({ mode: "host", host: "UPPER.invalid", slug: "alder-creek", platformOrigin: PLATFORM })).toThrow();
    expect(() => buildSiteUrls({ mode: "host", host: "a.invalid/x", slug: "alder-creek", platformOrigin: PLATFORM })).toThrow();
    expect(() => buildSiteUrls({ mode: "host", host: "a.invalid:8080", slug: "alder-creek", platformOrigin: PLATFORM })).toThrow();
    expect(() => buildSiteUrls({ mode: "host", host: "good.invalid", slug: "x.y", platformOrigin: PLATFORM })).toThrow();
  });
});

describe("slugSitePath", () => {
  it("is the one platform-host slug URL builder", () => {
    expect(slugSitePath("alder-creek")).toBe("/site/alder-creek");
    expect(slugSitePath("alder-creek", "/")).toBe("/site/alder-creek");
    expect(slugSitePath("alder-creek", "/assets/k")).toBe("/site/alder-creek/assets/k");
    expect(slugSitePath("alder-creek", "give")).toBe("/site/alder-creek/give");
  });

  it("never throws on an unvalidated route param: it encodes, so a platform page 404s instead of 500ing", () => {
    expect(() => slugSitePath("Bad Slug/../x")).not.toThrow();
    expect(slugSitePath("Bad Slug/../x")).toBe("/site/Bad%20Slug%2F..%2Fx");
    expect(slugSitePath("")).toBe("/site/");
  });
});

// ---------------------------------------------------------------------------
// The tripwire (DECISION-181): no hand-built /site/${...} URL outside the two
// files that own the form. A new call site that builds one by hand is the
// regression this exists to catch: on a custom host it links into the
// platform's URL space.
// ---------------------------------------------------------------------------

const SRC = path.resolve(__dirname, "..");
const ALLOWED = new Set(["lib/site-urls.ts", "lib/domains/host.ts"]);

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full;
  }
}

/** Code with comments blanked, strings left intact (a template literal is code). */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

describe("source scan: no hand-built /site/<slug> URL", () => {
  const files = [...walk(SRC)].map((f) => ({ rel: path.relative(SRC, f).split(path.sep).join("/"), full: f }));

  it("walks a real tree (a vacuous pass would hide a broken scan)", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(files.some((f) => f.rel === "lib/sites.ts")).toBe(true);
  });

  it("bans a template literal `/site/${...}` and string-concatenated `\"/site/\" +` outside site-urls.ts and host.ts", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (ALLOWED.has(f.rel)) continue;
      const code = codeOnly(readFileSync(f.full, "utf8"));
      code.split("\n").forEach((line, i) => {
        if (/`[^`]*\/site\/\$\{/.test(line) || /["']\/site\/["']\s*\+/.test(line) || /\+\s*["']\/site\/["']/.test(line)) {
          offenders.push(`${f.rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the scan does catch the forms it bans (self-test on synthetic lines)", () => {
    const bad = ["const a = `/site/${slug}/about`;", 'const b = "/site/" + slug;', "const c = '/site/' + slug + '/x';", "x(`${origin}/site/${slug}/give`)"];
    for (const line of bad) {
      const hit = /`[^`]*\/site\/\$\{/.test(line) || /["']\/site\/["']\s*\+/.test(line) || /\+\s*["']\/site\/["']/.test(line);
      expect(hit, line).toBe(true);
    }
    expect(/`[^`]*\/site\/\$\{/.test("const a = slugSitePath(slug);")).toBe(false);
  });
});

describe("source scan: VERCEL_PROJECT_PRODUCTION_URL is never read (F148)", () => {
  it("appears in no non-test source outside comments", () => {
    const offenders: string[] = [];
    for (const full of walk(SRC)) {
      const code = codeOnly(readFileSync(full, "utf8"));
      if (code.includes("VERCEL_PROJECT_PRODUCTION_URL")) offenders.push(path.relative(SRC, full));
    }
    expect(offenders).toEqual([]);
  });
});

describe("every segment under (public)/site/[slug] is force-dynamic (so a custom host can never serve a stale page)", () => {
  const root = path.join(SRC, "app/(public)/site/[slug]");
  const entries = [...walk(root)].filter((f) => /(^|\/)(layout\.tsx|route\.ts|page\.tsx)$/.test(f));

  it("the layout declares it for the whole subtree", () => {
    const layout = readFileSync(path.join(root, "layout.tsx"), "utf8");
    expect(layout).toMatch(/export const dynamic = "force-dynamic"/);
  });

  it("every route handler and every page that exports a revalidate/cache setting is dynamic, and none is static", () => {
    const routeHandlers = entries.filter((f) => f.endsWith("route.ts"));
    expect(routeHandlers.length).toBeGreaterThanOrEqual(3); // sitemap.xml, robots.txt, assets/[key]
    for (const f of routeHandlers) {
      expect(readFileSync(f, "utf8"), path.relative(root, f)).toMatch(/export const dynamic = "force-dynamic"/);
    }
    for (const f of entries) {
      const code = codeOnly(readFileSync(f, "utf8"));
      expect(code, path.relative(root, f)).not.toMatch(/export const (revalidate|fetchCache)\b/);
      expect(code, path.relative(root, f)).not.toMatch(/generateStaticParams/);
      expect(code, path.relative(root, f)).not.toMatch(/dynamic\s*=\s*["'](force-static|error)["']/);
    }
  });
});
