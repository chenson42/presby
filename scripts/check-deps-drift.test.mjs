/**
 * Fixture tests for the dependency-drift tripwire (DECISION-048 rules 1 to 3, DECISION-343
 * rules 4 to 6). A rule nobody has proved fires is a rule that drifts, and this script had
 * no test before the map: every rule here has a violating sample, plus the legal neighbours
 * that must NOT fire, plus a check that the real repository is clean and that planting a
 * violation in a real file makes the real scan fail. Same shape as
 * `check-treasury-boundaries.test.mjs`.
 *
 * Run via: npm test
 */
import { describe, it, expect } from "vitest";
import {
  LEAFLET_FILE,
  checkDepsDrift,
  checkDepsDriftTree,
  checkLeafletHasItsImporter,
  collectFiles,
} from "./check-deps-drift.mjs";
import { readFileSync } from "node:fs";

/** @param {string} path @param {string} content */
const f = (path, content) => ({ path, content });
const rules = (violations) => [...new Set(violations.map((v) => v.rule))].sort();

const PKG = {
  dependencies: { leaflet: "~1.9.4", "@radix-ui/react-dialog": "^1.0.0", next: "^16.0.0" },
  devDependencies: { "@types/leaflet": "~1.9.22" },
};
const LOCK = {
  packages: {
    "": { dependencies: { leaflet: "~1.9.4", "@radix-ui/react-dialog": "^1.0.0" }, devDependencies: { "@types/leaflet": "~1.9.22" } },
    "node_modules/leaflet": { version: "1.9.4" },
  },
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const run = (over = {}) => checkDepsDrift({ pkg: PKG, lock: LOCK, files: [], ...over });

const MAP_OK = 'import L from "leaflet";\nimport "leaflet/dist/leaflet.css";\nexport const x = L;';

describe("a clean tree", () => {
  it("passes with the dependency declared and imported only by the map file", () => {
    expect(run({ files: [f(LEAFLET_FILE, MAP_OK), f("src/a.tsx", 'import { Dialog } from "@radix-ui/react-dialog";')] })).toEqual([]);
  });

  it("passes before the map exists (nothing declared, nothing imported)", () => {
    expect(checkDepsDrift({ pkg: { dependencies: { next: "^16" } }, lock: null, files: [f("src/a.ts", "export const a = 1;")] })).toEqual([]);
  });

  it("tolerates a missing lockfile (a fresh clone before install)", () => {
    expect(checkDepsDrift({ pkg: PKG, lock: null, files: [] })).toEqual([]);
  });
});

describe("rule 1 - the radix-ui umbrella is not a dependency", () => {
  it("fires for package.json (either block) and for the lockfile root", () => {
    expect(rules(run({ pkg: { ...clone(PKG), dependencies: { ...PKG.dependencies, "radix-ui": "^1" } } }))).toEqual([1]);
    expect(rules(run({ pkg: { ...clone(PKG), devDependencies: { ...PKG.devDependencies, "radix-ui": "^1" } } }))).toEqual([1]);
    const lock = clone(LOCK);
    lock.packages[""].dependencies["radix-ui"] = "^1";
    expect(run({ lock }).map((v) => v.where)).toEqual(["package-lock.json"]);
    expect(rules(run({ lock }))).toEqual([1]);
  });
});

describe("rule 2 - nothing imports the umbrella", () => {
  it("fires for a from-import and for a multi-line one", () => {
    expect(rules(run({ files: [f("src/a.tsx", 'import { Dialog } from "radix-ui";')] }))).toEqual([2]);
    expect(rules(run({ files: [f("src/a.tsx", 'import {\n  Dialog,\n} from "radix-ui";')] }))).toEqual([2]);
  });

  it("does not fire for a comment that quotes the import, or for a scoped package", () => {
    expect(run({ files: [f("src/a.tsx", '// never: import { Dialog } from "radix-ui";\n/* from "radix-ui" */\nexport const a = 1;')] })).toEqual([]);
    expect(run({ files: [f("src/a.tsx", 'import x from "@radix-ui/react-dialog";')] })).toEqual([]);
  });
});

describe("rule 3 - every @radix-ui/react-* import is declared", () => {
  it("fires for a package nobody installed", () => {
    expect(rules(run({ files: [f("src/a.tsx", 'import x from "@radix-ui/react-popover";')] }))).toEqual([3]);
  });
  it("does not fire for a declared one", () => {
    expect(run({ files: [f("src/a.tsx", 'import x from "@radix-ui/react-dialog";')] })).toEqual([]);
  });
});

describe("rule 4 - leaflet and @types/leaflet: placement and tilde range", () => {
  it.each(["^1.9.4", "1.9.4", ">=1.9", "~2.0.0-beta.4", "^2.0.0", "latest", "~1.10.0", "~1.8.0", "*", "~1.9"])(
    "fires for leaflet at %s (a caret, an exact pin, a range or another minor)",
    (range) => {
      const pkg = clone(PKG);
      pkg.dependencies.leaflet = range;
      expect(rules(run({ pkg, lock: null }))).toEqual([4]);
    },
  );

  it("fires for @types/leaflet with a caret", () => {
    const pkg = clone(PKG);
    pkg.devDependencies["@types/leaflet"] = "^1.9.22";
    expect(rules(run({ pkg, lock: null }))).toEqual([4]);
  });

  it("fires when leaflet is a devDependency (it ships to the browser) and when @types/leaflet is a runtime dependency", () => {
    const a = { dependencies: { next: "^16" }, devDependencies: { leaflet: "~1.9.4", "@types/leaflet": "~1.9.22" } };
    expect(rules(run({ pkg: a, lock: null }))).toEqual([4]);
    const b = { dependencies: { leaflet: "~1.9.4", "@types/leaflet": "~1.9.22" }, devDependencies: {} };
    expect(rules(run({ pkg: b, lock: null }))).toEqual([4]);
  });

  it("fires when the lockfile root disagrees with package.json, or carries a caret", () => {
    const lock = clone(LOCK);
    lock.packages[""].dependencies.leaflet = "~1.9.3";
    expect(run({ lock }).map((v) => v.where)).toEqual(["package-lock.json"]);
    expect(rules(run({ lock }))).toEqual([4]);
    const caret = clone(LOCK);
    caret.packages[""].dependencies.leaflet = "^1.9.4";
    expect(rules(run({ lock: caret }))).toEqual([4]);
  });

  it("fires when src imports leaflet but package.json does not declare it", () => {
    const pkg = { dependencies: { next: "^16" } };
    expect(rules(checkDepsDrift({ pkg, lock: null, files: [f(LEAFLET_FILE, MAP_OK)] }))).toEqual([4]);
  });

  it("accepts every tilde patch inside 1.9", () => {
    for (const range of ["~1.9.0", "~1.9.4", "~1.9.12"]) {
      const pkg = clone(PKG);
      pkg.dependencies.leaflet = range;
      expect(run({ pkg, lock: null })).toEqual([]);
    }
  });

  it("does not fire for a neighbouring package whose name merely starts with leaflet", () => {
    const pkg = clone(PKG);
    pkg.dependencies["leaflet-draw"] = "^1.0.4";
    expect(run({ pkg, lock: null })).toEqual([]);
  });
});

describe("rule 5 - react-leaflet appears nowhere", () => {
  it.each(["react-leaflet", "@react-leaflet/core"])("fires for %s in package.json and in the lockfile root", (name) => {
    const pkg = clone(PKG);
    pkg.dependencies[name] = "^5.0.0";
    expect(rules(run({ pkg, lock: null }))).toEqual([5]);
    const dev = clone(PKG);
    dev.devDependencies[name] = "^5.0.0";
    expect(rules(run({ pkg: dev, lock: null }))).toEqual([5]);
    const lock = clone(LOCK);
    lock.packages[""].dependencies[name] = "^5.0.0";
    expect(rules(run({ lock }))).toEqual([5]);
  });

  it("fires for an installed copy anywhere in the lockfile (a transitive pull)", () => {
    const lock = clone(LOCK);
    lock.packages["node_modules/some-wrapper/node_modules/react-leaflet"] = { version: "5.0.0" };
    expect(rules(run({ lock }))).toEqual([5]);
    const scoped = clone(LOCK);
    scoped.packages["node_modules/@react-leaflet/core"] = { version: "3.0.0" };
    expect(rules(run({ lock: scoped }))).toEqual([5]);
  });

  it.each(['import { MapContainer } from "react-leaflet";', 'import { x } from "react-leaflet/lib/y";', 'import { c } from "@react-leaflet/core";', 'const m = require("react-leaflet");', 'const m = await import("react-leaflet");'])(
    "fires for an import: %s",
    (line) => {
      expect(rules(run({ files: [f("src/a.tsx", line)] }))).toEqual([5]);
    },
  );

  it("does not fire for a comment that names it", () => {
    expect(run({ files: [f("src/a.tsx", '// we do not use react-leaflet (Hippocratic-2.1)\n/* import x from "react-leaflet" */')] })).toEqual([]);
  });
});

describe("rule 6 - leaflet is imported by exactly one file", () => {
  it.each([
    ["a static import", 'import L from "leaflet";'],
    ["a namespace import", 'import * as L from "leaflet";'],
    ["a side-effect import", 'import "leaflet";'],
    ["the stylesheet", 'import "leaflet/dist/leaflet.css";'],
    ["a deep import", 'import { Map } from "leaflet/src/map/Map";'],
    ["a dynamic import", 'const L = await import("leaflet");'],
    ["a multi-line dynamic import", 'const L = await import(\n  "leaflet"\n);'],
    ["a require", 'const L = require("leaflet");'],
    ["a type-only import", 'import type { Map } from "leaflet";'],
    ["a type-only namespace import", 'import type * as L from "leaflet";'],
    ["a re-export", 'export { default } from "leaflet";'],
    ["a multi-line named import", 'import {\n  Map,\n  Marker,\n} from "leaflet";'],
  ])("fires for %s in any other file", (_name, line) => {
    const violations = run({ files: [f("src/app/other/page.tsx", line)] });
    expect(rules(violations)).toEqual([6]);
    expect(violations[0].where.startsWith("src/app/other/page.tsx:")).toBe(true);
  });

  it("fires for the loader and for a sibling in the insights directory (only map.tsx)", () => {
    const dir = "src/app/(org)/o/[slug]/admin/insights";
    expect(rules(run({ files: [f(`${dir}/map-loader.tsx`, 'import L from "leaflet";')] }))).toEqual([6]);
    expect(rules(run({ files: [f(`${dir}/map-support.ts`, 'import type { LatLng } from "leaflet";')] }))).toEqual([6]);
  });

  it("does not fire in the one file", () => {
    expect(run({ files: [f(LEAFLET_FILE, MAP_OK)] })).toEqual([]);
  });

  it("does not fire for a comment, a string that is not an import, or a different package", () => {
    expect(run({ files: [f("src/a.ts", '// import L from "leaflet";\n/* import "leaflet/dist/leaflet.css" */')] })).toEqual([]);
    expect(run({ files: [f("src/a.ts", 'const s = "leaflet";\nconst t = "see leaflet docs";')] })).toEqual([]);
    expect(run({ files: [f("src/a.ts", 'import d from "leaflet-draw";\nimport p from "leaflet.markercluster";\nimport e from "my-leaflet";')] })).toEqual([]);
  });

  it("does not fire for a test file that mocks the module by name (it never ships)", () => {
    expect(run({ files: [f("src/x/map.test.tsx", 'vi.mock("leaflet", () => ({}));\nvi.mock("leaflet/dist/leaflet.css", () => ({}));')] })).toEqual([]);
    expect(run({ files: [f("src/x/sample.test.ts", 'const sample = `import L from "leaflet";`;\nimport L from "leaflet";')] })).toEqual([]);
  });

  describe("the other half: the one file must exist and import both", () => {
    it("fails when the file is missing", () => {
      expect(rules(checkLeafletHasItsImporter([f("src/a.ts", "export const a = 1;")]))).toEqual([6]);
    });
    it("fails when it stopped importing the library", () => {
      const v = checkLeafletHasItsImporter([f(LEAFLET_FILE, 'import "leaflet/dist/leaflet.css";')]);
      expect(v).toHaveLength(1);
      expect(v[0].message).toContain('"leaflet"');
    });
    it("fails when it stopped importing the stylesheet", () => {
      const v = checkLeafletHasItsImporter([f(LEAFLET_FILE, 'import L from "leaflet";')]);
      expect(v).toHaveLength(1);
      expect(v[0].message).toContain("leaflet/dist/leaflet.css");
    });
    it("fails when its imports are only in comments", () => {
      expect(checkLeafletHasItsImporter([f(LEAFLET_FILE, '// import L from "leaflet";\n// import "leaflet/dist/leaflet.css";')])).toHaveLength(2);
    });
    it("passes with both, and the whole-tree check adds it to the rest", () => {
      expect(checkLeafletHasItsImporter([f(LEAFLET_FILE, MAP_OK)])).toEqual([]);
      expect(rules(checkDepsDriftTree({ pkg: PKG, lock: LOCK, files: [f("src/a.ts", "export const a = 1;")] }))).toEqual([6]);
      expect(checkDepsDriftTree({ pkg: PKG, lock: LOCK, files: [f(LEAFLET_FILE, MAP_OK)] })).toEqual([]);
    });
  });
});

describe("the real repository", () => {
  it("is clean", async () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
    expect(checkDepsDriftTree({ pkg, lock, files: await collectFiles() })).toEqual([]);
  });

  it("pins leaflet with a tilde in package.json and the lockfile root", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.dependencies.leaflet).toMatch(/^~1\.9\.\d+$/);
    expect(pkg.devDependencies["@types/leaflet"]).toMatch(/^~1\.9\.\d+$/);
    expect(pkg.dependencies["react-leaflet"]).toBeUndefined();
  });

  it("planting a violation in a real file makes the real scan fail", async () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const files = await collectFiles();
    const loader = files.find((x) => x.path.endsWith("insights/map-loader.tsx"));
    expect(loader).toBeDefined();
    const planted = files.map((x) => (x === loader ? { ...x, content: `import L from "leaflet";\n${x.content}` } : x));
    expect(rules(checkDepsDriftTree({ pkg, lock: null, files: planted }))).toEqual([6]);
  });
});
