/**
 * Fixture tests for the proxy-imports tripwire (DECISION-177, F146). Synthetic
 * files go straight to checkProxyImports(), which takes { path, content }
 * rather than reading the disk - plus one test that walks the REAL repo graph
 * so a regression in the walker itself (it silently walking nothing) cannot
 * hide behind green fixtures.
 *
 * Run via: npm test
 */
import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  checkProxyImports,
  importSpecifiers,
  stripComments,
  DOMAINS_ALLOW_LIST,
} from "./check-proxy-imports.mjs";

/** @param {string} path @param {string} content */
const f = (path, content) => ({ path, content });
const rules = (v) => v.map((x) => x.rule).sort();

const PROXY_OK = `import { NextResponse } from "next/server";
import { edgeAuth } from "@/lib/auth/config";
import { isPlatformHost } from "@/lib/domains/host";
export async function proxy() { return NextResponse.next(); }`;

const clean = (proxy = PROXY_OK, ...more) => [
  f("src/proxy.ts", proxy),
  f("src/lib/auth/config.ts", 'import NextAuth from "next-auth"; export const edgeAuth = () => null;'),
  f("src/lib/domains/host.ts", "export const isPlatformHost = () => true;"),
  f("src/lib/domains/probe.ts", 'import { createHmac } from "node:crypto"; export const x = createHmac;'),
  f("src/lib/domains/cron-passthrough.ts", 'import { timingSafeEqual } from "node:crypto"; export const y = timingSafeEqual;'),
  ...more,
];

describe("a clean graph", () => {
  it("passes", () => {
    expect(checkProxyImports(clean())).toEqual([]);
  });

  it("allows exactly host.ts, probe.ts and cron-passthrough.ts from src/lib/domains", () => {
    expect([...DOMAINS_ALLOW_LIST].sort()).toEqual([
      "src/lib/domains/cron-passthrough.ts",
      "src/lib/domains/host.ts",
      "src/lib/domains/probe.ts",
    ]);
    const proxy = `${PROXY_OK}
import { answerProbe } from "@/lib/domains/probe";
import { isCronRequest } from "@/lib/domains/cron-passthrough";`;
    expect(checkProxyImports(clean(proxy))).toEqual([]);
  });

  it("does not follow a type-only import", () => {
    const proxy = `${PROXY_OK}
import type { Db } from "@/lib/db";
export type { Thing } from "@/lib/db/schema";`;
    expect(checkProxyImports(clean(proxy, f("src/lib/db/index.ts", "export type Db = 1;")))).toEqual([]);
  });

  it("does not count a commented-out import", () => {
    const proxy = `${PROXY_OK}
// import { db } from "@/lib/db";
/* import { db } from "@/lib/db";
   import { sites } from "@/lib/sites"; */
const glob = "src/**/*.ts"; // a glob in a string must not open a block comment
import { z } from "@/lib/auth/config";`;
    expect(checkProxyImports(clean(proxy, f("src/lib/db/index.ts", "export const db = 1;")))).toEqual([]);
  });
});

describe("P1 - forbidden in-repo modules", () => {
  it("fails a direct import of @/lib/db", () => {
    const proxy = `${PROXY_OK}\nimport { db } from "@/lib/db";`;
    const v = checkProxyImports(clean(proxy, f("src/lib/db/index.ts", "export const db = 1;")));
    expect(rules(v)).toEqual(["P1"]);
    expect(v[0].file).toBe("src/proxy.ts");
    expect(v[0].message).toContain("src/lib/db/**");
  });

  it("fails a deep import under src/lib/db/", () => {
    const proxy = `${PROXY_OK}\nimport { t } from "@/lib/db/domain/org";`;
    const v = checkProxyImports(clean(proxy, f("src/lib/db/domain/org.ts", "export const t = 1;")));
    expect(rules(v)).toEqual(["P1"]);
  });

  it("fails @/lib/sites and sites-*.ts", () => {
    for (const mod of ["sites", "sites-reserved-paths"]) {
      const proxy = `${PROXY_OK}\nimport { x } from "@/lib/${mod}";`;
      const v = checkProxyImports(clean(proxy, f(`src/lib/${mod}.ts`, "export const x = 1;")));
      expect(rules(v), mod).toEqual(["P1"]);
    }
  });

  it("fails any other src/lib/domains module (service.ts, hostname-rules.ts, adapters/*)", () => {
    for (const mod of ["service", "hostname-rules", "adapters/vercel", "state"]) {
      const proxy = `${PROXY_OK}\nimport { x } from "@/lib/domains/${mod}";`;
      const v = checkProxyImports(clean(proxy, f(`src/lib/domains/${mod}.ts`, "export const x = 1;")));
      expect(rules(v), mod).toEqual(["P1"]);
    }
  });

  it("fails a TRANSITIVE violation and names the whole chain", () => {
    const files = clean(
      PROXY_OK,
      f("src/lib/auth/config.ts", 'import { helper } from "./helper"; export const edgeAuth = () => helper;'),
      f("src/lib/auth/helper.ts", 'import { db } from "@/lib/db"; export const helper = db;'),
      f("src/lib/db/index.ts", "export const db = 1;"),
    );
    // The later config.ts replaces the clean one (Map semantics: last write wins).
    const v = checkProxyImports(files);
    expect(rules(v)).toEqual(["P1"]);
    expect(v[0].chain).toEqual([
      "src/proxy.ts",
      "src/lib/auth/config.ts",
      "src/lib/auth/helper.ts",
      "src/lib/db/index.ts",
    ]);
  });

  it("fails a relative import that lands in a forbidden directory", () => {
    const files = clean(
      PROXY_OK,
      f("src/lib/auth/config.ts", 'import { db } from "../db/index"; export const edgeAuth = () => db;'),
      f("src/lib/db/index.ts", "export const db = 1;"),
    );
    expect(rules(checkProxyImports(files))).toEqual(["P1"]);
  });

  it("fails a DYNAMIC import()", () => {
    const proxy = `${PROXY_OK}\nexport const lazy = () => import("@/lib/db");`;
    const v = checkProxyImports(clean(proxy, f("src/lib/db/index.ts", "export const db = 1;")));
    expect(rules(v)).toEqual(["P1"]);
  });

  it("fails a require() and a re-export", () => {
    const viaRequire = `${PROXY_OK}\nconst d = require("@/lib/db");`;
    expect(rules(checkProxyImports(clean(viaRequire, f("src/lib/db/index.ts", "x"))))).toEqual(["P1"]);
    const viaExport = `${PROXY_OK}\nexport { db } from "@/lib/db";`;
    expect(rules(checkProxyImports(clean(viaExport, f("src/lib/db/index.ts", "x"))))).toEqual(["P1"]);
  });

  it("fails a side-effect import", () => {
    const proxy = `${PROXY_OK}\nimport "@/lib/db";`;
    expect(rules(checkProxyImports(clean(proxy, f("src/lib/db/index.ts", "x"))))).toEqual(["P1"]);
  });
});

describe("P2 - server-only", () => {
  it("fails a reachable file that imports server-only, even outside the forbidden dirs", () => {
    const files = clean(
      PROXY_OK,
      f("src/lib/auth/config.ts", 'import "@/lib/thing"; export const edgeAuth = () => null;'),
      f("src/lib/thing.ts", 'import "server-only"; export const a = 1;'),
    );
    const v = checkProxyImports(files);
    expect(rules(v)).toEqual(["P2"]);
    expect(v[0].file).toBe("src/lib/thing.ts");
  });

  it("ignores a server-only mention in a comment", () => {
    const files = clean(
      PROXY_OK,
      f("src/lib/auth/config.ts", '// import "server-only"\nexport const edgeAuth = () => null;'),
    );
    expect(checkProxyImports(files)).toEqual([]);
  });
});

describe("P3 - banned bare packages", () => {
  it("fails each of them, from the proxy and from a transitive file", () => {
    for (const pkg of [
      "@neondatabase/serverless",
      "drizzle-orm",
      "drizzle-orm/neon-serverless",
      "@auth/drizzle-adapter",
      "pg",
      "ws",
      "resend",
      "bcryptjs",
    ]) {
      const proxy = `${PROXY_OK}\nimport x from "${pkg}";`;
      expect(rules(checkProxyImports(clean(proxy))), pkg).toEqual(["P3"]);

      const files = clean(
        PROXY_OK,
        f("src/lib/auth/config.ts", 'import "./deep"; export const edgeAuth = () => null;'),
        f("src/lib/auth/deep.ts", `import x from "${pkg}";`),
      );
      expect(rules(checkProxyImports(files)), `${pkg} (transitive)`).toEqual(["P3"]);
    }
  });

  it("does not confuse a package that merely starts with the name", () => {
    for (const pkg of ["pgp", "wsx", "resend-extra", "drizzle-orm-fake"]) {
      const proxy = `${PROXY_OK}\nimport x from "${pkg}";`;
      expect(checkProxyImports(clean(proxy)), pkg).toEqual([]);
    }
  });
});

describe("P4 - holes in the graph", () => {
  it("fails an in-repo specifier that does not resolve", () => {
    const proxy = `${PROXY_OK}\nimport { x } from "@/lib/does-not-exist";`;
    const v = checkProxyImports(clean(proxy));
    expect(rules(v)).toEqual(["P4"]);
  });

  it("fails when the entry itself is missing", () => {
    expect(rules(checkProxyImports([]))).toEqual(["P4"]);
  });

  it("lets a non-code asset import through", () => {
    const proxy = `${PROXY_OK}\nimport "./styles.css";`;
    expect(checkProxyImports(clean(proxy))).toEqual([]);
  });
});

describe("the scanner helpers", () => {
  it("importSpecifiers reads every runtime form and skips type-only ones", () => {
    const code = stripComments(`
      import a from "a";
      import { b } from 'b';
      import "c";
      export * from "d";
      export { e } from "e";
      import type { T } from "f";
      export type { U } from "g";
      const h = await import("h");
      const i = require("i");
    `);
    expect(importSpecifiers(code).sort()).toEqual(["a", "b", "c", "d", "e", "h", "i"]);
  });

  it("stripComments keeps line numbers and string contents", () => {
    const src = 'const a = "// not a comment";\n/* x\n y */\nconst b = `/* nor this */`;';
    const out = stripComments(src);
    expect(out.split("\n").length).toBe(src.split("\n").length);
    expect(out).toContain('"// not a comment"');
    expect(out).toContain("`/* nor this */`");
    expect(out).not.toContain("y */");
  });
});

describe("the real repository graph", () => {
  it("is non-empty and passes: the walker really reads src/proxy.ts's imports", async () => {
    const root = path.resolve(import.meta.dirname, "..");
    const files = [];
    async function walk(dir) {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (/\.(ts|tsx|mts|js|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) {
          files.push({
            path: path.relative(root, full).split(path.sep).join("/"),
            content: await fs.readFile(full, "utf8"),
          });
        }
      }
    }
    await walk(path.join(root, "src"));

    expect(checkProxyImports(files)).toEqual([]);

    // Plant a violation in the REAL proxy source: it must be caught, which proves
    // the clean result above is not the walker silently reading nothing.
    const planted = files.map((x) =>
      x.path === "src/proxy.ts" ? { ...x, content: `${x.content}\nimport { db } from "@/lib/db";` } : x,
    );
    expect(rules(checkProxyImports(planted))).toEqual(["P1"]);
  });
});
