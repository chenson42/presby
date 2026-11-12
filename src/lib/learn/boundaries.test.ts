/**
 * T3 - source-scan boundaries for the Learn feature (docs/work-log/2026-11-10-learn-inc1a.md,
 * Phase 2 ruling 4 and Phase 3 T3; DECISION-333, DECISION-336). Each is a property the type
 * system and the database cannot see, and review would catch only by luck. The precedents:
 * `src/lib/worship/boundaries.test.ts` and `src/lib/careers/boundaries.test.ts`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const isTest = (file: string) => /\.test\.(ts|tsx)$/.test(file);
const rel = (file: string) => path.relative(ROOT, file);
const read = (file: string) => readFileSync(file, "utf8");
/** Source with comments removed, so a scan never trips on the prose that explains the rule. */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const COMPONENTS = path.join(SRC, "components/learn");
const LIB = path.join(SRC, "lib/learn");
const PUBLIC_LEARN = path.join(SRC, "app/(public)/site/[slug]/learn");
const ORG_LEARN = path.join(SRC, "app/(org)/o/[slug]/learn");
const SLOT = path.join(SRC, "app/(public)/site/[slug]/spot-the-scam-slot.tsx");
const ISLAND = path.join(COMPONENTS, "scam-trainer.tsx");

/** Every application (non-test) file that is Learn UI or Learn lib. */
const learnFiles = () =>
  [...walk(LIB), ...walk(COMPONENTS), ...walk(PUBLIC_LEARN), ...walk(ORG_LEARN), SLOT].filter(
    (f) => !isTest(f) && existsSync(f),
  );

describe("the island is sealed (Phase 2 ruling 4; F437)", () => {
  const src = code(ISLAND);

  it("imports only react, lucide-react, the Button primitive, HydrationGate and the two pure content files", () => {
    const specs = [...src.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]!);
    const allowed = new Set([
      "react",
      "lucide-react",
      "@/components/ui/button",
      "@/components/shared/hydration-gate",
      "@/lib/learn/spot-the-scam/content",
      "@/lib/learn/spot-the-scam/copy",
    ]);
    expect(specs.filter((s) => !allowed.has(s))).toEqual([]);
    // ...and it really does import the content (a scan that matched nothing would prove nothing).
    expect(specs).toContain("@/lib/learn/spot-the-scam/content");
    expect(specs).toContain("@/components/shared/hydration-gate");
    expect(src).not.toMatch(/\bimport\s*\(/); // no dynamic import either
    expect(src).not.toMatch(/\brequire\s*\(/);
  });

  it.each([
    ["fetch", /\bfetch\b/],
    ["XMLHttpRequest", /\bXMLHttpRequest\b/],
    ["sendBeacon", /\bsendBeacon\b/],
    ["WebSocket", /\bWebSocket\b/],
    ["EventSource", /\bEventSource\b/],
    ["'use server'", /["']use server["']/],
    ["next/* (next/link prefetches; next/navigation navigates)", /from\s+["']next\b/],
    ["localStorage", /\blocalStorage\b/],
    ["sessionStorage", /\bsessionStorage\b/],
    ["document.cookie", /\bdocument\s*\.\s*cookie\b/],
    ["indexedDB", /\bindexedDB\b/],
    ["an anchor element", /<a[\s>]/],
    ["an href", /\bhref\b/],
    ["window.open", /\bwindow\s*\.\s*open\b/],
    ["location", /\blocation\b/],
    ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
    ["getPlatformDb", /getPlatformDb/],
    // Resource-load beacons: no fetch/XHR, yet each sends a request (QA O1).
    ["new Image (an image beacon)", /\bnew\s+Image\b/],
    ["an assignment to .src", /\.\s*src\s*=(?!=)/],
    ["document.createElement", /\bdocument\s*\.\s*createElement\b/],
  ])("the island does not use %s", (_name, pattern) => {
    expect(src).not.toMatch(pattern);
  });

  it("takes no props: it is handed no URL and no organization", () => {
    expect(src).toMatch(/export function ScamTrainer\(\)\s*\{/);
  });

  it("is the ONLY 'use client' file under src/components/learn/", () => {
    const clients = walk(COMPONENTS)
      .filter((f) => !isTest(f))
      .filter((f) => /^\s*["']use client["']/.test(read(f)))
      .map(rel);
    expect(clients).toEqual(["src/components/learn/scam-trainer.tsx"]);
  });

  it("no other client file exists anywhere in the Learn trees (public route, slot, (org) page, lib)", () => {
    const clients = [...walk(LIB), ...walk(PUBLIC_LEARN), ...walk(ORG_LEARN), SLOT]
      .filter((f) => !isTest(f) && existsSync(f))
      .filter((f) => /^\s*["']use client["']/.test(read(f)))
      .map(rel);
    expect(clients).toEqual([]);
  });
});

describe("the content modules are pure data (DECISION-333)", () => {
  for (const name of ["content.ts", "copy.ts"]) {
    it(`src/lib/learn/spot-the-scam/${name} imports nothing`, () => {
      const file = path.join(LIB, "spot-the-scam", name);
      expect(code(file)).not.toMatch(/^\s*import\b/m);
      expect(code(file)).not.toMatch(/\bimport\s*\(/);
    });
  }

  it("contract.ts imports nothing (it is safe for a client component and the proxy's neighbours)", () => {
    expect(code(path.join(LIB, "contract.ts"))).not.toMatch(/^\s*import\b/m);
  });
});

describe("the platform connection and the two hierarchies", () => {
  it("getPlatformDb appears in no Learn lib, component, route or slot file", () => {
    const offenders = learnFiles().filter((f) => /getPlatformDb/.test(code(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("nothing under (admin) or admin-portal imports the Learn lib or components", () => {
    const offenders = [
      ...walk(path.join(SRC, "app/(admin)")),
      ...walk(path.join(SRC, "lib/admin-portal")),
      ...walk(path.join(SRC, "components/admin-portal")),
    ].filter((f) => /@\/lib\/learn|@\/components\/learn/.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("the proxy and the pure site-url module import nothing from @/lib/learn (both must stay pure and proxy-safe)", () => {
    for (const file of [path.join(SRC, "proxy.ts"), path.join(SRC, "lib/site-urls.ts")]) {
      // An import specifier, not prose: site-urls.ts's comments name the contract file.
      const specs = [...code(file).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
      expect(
        specs.filter((x) => /lib\/learn/.test(x)),
        rel(file),
      ).toEqual([]);
    }
  });

  it("no Learn file reads a session, a cookie, a header or a request value on the public side", () => {
    const publicSide = [...walk(PUBLIC_LEARN), SLOT, ...walk(COMPONENTS), ...walk(LIB)].filter(
      (f) => !isTest(f) && existsSync(f),
    );
    // The (org) page reads a session by design (it is auth-gated); the public side never does.
    const offenders = publicSide.filter((f) => {
      const text = code(f);
      return /\bauth\(\)|cachedAuth|from\s+["']next\/headers["']|\bcookies\(\)|\bheaders\(\)/.test(text);
    });
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("the route shape (Phase 2 Note 1: the bundle wins, /learn is bundle territory)", () => {
  it("src/app/(public)/site/[slug]/learn/ holds exactly the directory spot-the-scam, which holds only page.tsx (and its test)", () => {
    expect(readdirSync(PUBLIC_LEARN).sort()).toEqual(["spot-the-scam"]);
    const children = readdirSync(path.join(PUBLIC_LEARN, "spot-the-scam")).filter((n) => !/\.test\.(ts|tsx)$/.test(n));
    expect(children).toEqual(["page.tsx"]);
  });

  it("there is no learn/page.tsx, no [param] and no [...x] segment in the public tree: the catch-all keeps /learn and /learn/<other>", () => {
    const all: string[] = [];
    const collect = (dir: string) => {
      for (const name of readdirSync(dir)) {
        all.push(path.relative(PUBLIC_LEARN, path.join(dir, name)));
        if (statSync(path.join(dir, name)).isDirectory()) collect(path.join(dir, name));
      }
    };
    collect(PUBLIC_LEARN);
    expect(all.filter((p) => /\[/.test(p))).toEqual([]);
    expect(existsSync(path.join(PUBLIC_LEARN, "page.tsx"))).toBe(false);
    expect(existsSync(path.join(PUBLIC_LEARN, "layout.tsx"))).toBe(false);
  });

  it("the (org) learn tree holds exactly spot-the-scam", () => {
    expect(readdirSync(ORG_LEARN).sort()).toEqual(["spot-the-scam"]);
  });

  it("no loading.tsx under either learn route tree (both can 404 or notFound(); a Suspense boundary would flush a 200 first)", () => {
    const loading = [...walk(PUBLIC_LEARN), ...walk(ORG_LEARN)].filter((f) => path.basename(f) === "loading.tsx");
    expect(loading).toEqual([]);
    for (const dir of [PUBLIC_LEARN, ORG_LEARN]) {
      const all: string[] = [];
      const collect = (d: string) => {
        for (const name of readdirSync(d)) {
          if (name.startsWith("loading.")) all.push(path.join(d, name));
          if (statSync(path.join(d, name)).isDirectory()) collect(path.join(d, name));
        }
      };
      collect(dir);
      expect(all, dir).toEqual([]);
    }
  });
});

describe("the brand cascade and the accessibility floor (DECISION-046, DECISION-336, F441)", () => {
  const ui = walk(COMPONENTS).filter((f) => !isTest(f));

  it("there are component files to scan (a scan that matched nothing would prove nothing)", () => {
    expect(ui.map((f) => path.basename(f)).sort()).toEqual([
      "leader-panel.tsx",
      "learn-notices.tsx",
      "scam-rules-card.tsx",
      "scam-trainer.tsx",
      "spot-the-scam-frame.tsx",
    ]);
  });

  it("no raw palette colour, no *-brand utility and no dark: colour override", () => {
    const PALETTE =
      /\b(?:text|bg|border|ring|fill|stroke|from|to|via|outline|divide|decoration|accent|caret|shadow)-(?:red|green|blue|yellow|orange|amber|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)(?:-\d{2,3})?\b/;
    for (const file of ui) {
      const text = code(file);
      expect(text, rel(file)).not.toMatch(PALETTE);
      expect(text, rel(file)).not.toMatch(/-brand\b/);
      expect(text, rel(file)).not.toMatch(/\bdark:(?:text|bg|border|ring)-/);
    }
  });

  it("no text-sm, text-xs, text-base or an arbitrary text size (nothing below the text-lg role; the 17px bar is expressed in the type scale)", () => {
    for (const file of ui.filter((f) => path.basename(f) !== "leader-panel.tsx")) {
      expect(code(file), rel(file)).not.toMatch(/\btext-(?:sm|xs)\b|\btext-\[/);
    }
    // The leader panel is portal chrome for a member who already has the page: it follows the
    // portal's own `text-base` and may not go below it.
    expect(code(path.join(COMPONENTS, "leader-panel.tsx"))).not.toMatch(/\btext-(?:sm|xs)\b|\btext-\[/);
    // The trainer and the frame go no lower than text-lg.
    for (const name of ["scam-trainer.tsx", "scam-rules-card.tsx", "spot-the-scam-frame.tsx", "learn-notices.tsx"]) {
      expect(code(path.join(COMPONENTS, name)), name).not.toMatch(/\btext-base\b/);
    }
  });

  it("no animation or transition of its own, and no dangerouslySetInnerHTML anywhere in the Learn trees", () => {
    for (const file of ui) {
      expect(code(file), rel(file)).not.toMatch(/\banimate-|\btransition(?:-|\b)/);
    }
    for (const file of learnFiles()) {
      expect(code(file), rel(file)).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });

  it("the island is print:hidden, and the rules card carries no print utility (it prints)", () => {
    expect(read(ISLAND)).toMatch(/print:hidden/);
    expect(code(path.join(COMPONENTS, "scam-rules-card.tsx"))).not.toMatch(/print:/);
  });

  it("every control in the island is a `touch` (44px) Button", () => {
    const text = code(ISLAND);
    const buttons = [...text.matchAll(/<Button\b[^>]*>/g)].map((m) => m[0]);
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const b of buttons) expect(b).toMatch(/size="touch"/);
    expect(text).not.toMatch(/<button\b/);
  });

  it("button.tsx's header records the `touch` size as divergence #8, and the variant exists", () => {
    const button = read(path.join(SRC, "components/ui/button.tsx"));
    expect(button).toMatch(/^\/\/\s+8\. Added a `touch` size variant/m);
    expect(button).toMatch(/touch:\s*"h-11 /);
  });
});
