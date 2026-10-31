/**
 * U2: static source scans for the person-photos module (DECISION-285/286/289;
 * docs/work-log/2026-10-26-person-photos-inc1.md, Phase 3 Test Plan U2). They
 * are tripwires, not the real control: the DB tests prove the rules, these catch
 * the next file that quietly breaks them.
 *
 *   1. `sharp` is imported by `image.ts` and nothing else.
 *   2. The two tables are named only by `store.ts` (the only writer), `reader.ts`,
 *      the Drizzle declaration, and the dev-docs classification.
 *   3. `getBlobStore().store(` appears only in `store.ts`, twice, each with the
 *      literal `audience: "private"`.
 *   4. No TypeScript reads the retired `people.photo_key` / `photo_updated_at`.
 *   5. No route handler belongs to the feature (no new enumerable path,
 *      DECISION-040); no `getPlatformDb` anywhere in it.
 *   6. The SQL wrapper over the owner-only core is named only in `reader.ts`.
 *   7. The feature never writes the three listing tables (staff, officers,
 *      committees): listing is a read, and a separate permission.
 *   8. `actions.ts` holds no `db.` call (the checks live in `store.ts`).
 *   9. `directory.ts` calls `presby_person_directory_photo` exactly once, and has
 *      no other photo column: the zero-photo directory path is one statement.
 *
 * Test files and the shared fixtures under `src/lib/testing/` are excluded.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const isTest = (file: string) => /\.(test|spec)\.(ts|tsx)$/.test(file);
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const code = (file: string) => stripComments(readFileSync(file, "utf8"));
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
const at = (...parts: string[]) => path.join(SRC, ...parts);

const TESTING_DIR = at("lib", "testing") + path.sep;
const APP_FILES = walk(SRC).filter((f) => !isTest(f) && !f.startsWith(TESTING_DIR));

const FEATURE_LIB = at("lib", "person-photos") + path.sep;
const PHOTOS_PAGE_DIR = at("app", "(org)", "o", "[slug]", "admin", "community", "[id]", "edit", "photos") + path.sep;
const FEATURE_FILES = APP_FILES.filter((f) => f.startsWith(FEATURE_LIB) || f.startsWith(PHOTOS_PAGE_DIR));

describe("sharp (R6)", () => {
  it("is imported by image.ts and image-sanitize.ts and nothing else (DECISION-312)", () => {
    const importers = APP_FILES.filter((f) => /from\s+["']sharp["']|require\(\s*["']sharp["']\s*\)|import\(\s*["']sharp["']\s*\)/.test(code(f)));
    expect(importers.map(rel).sort()).toEqual(["src/lib/person-photos/image.ts", "src/lib/storage/image-sanitize.ts"]);
  });

  it("image.ts is server-only", () => {
    expect(readFileSync(at("lib", "person-photos", "image.ts"), "utf8")).toMatch(/^import "server-only";/m);
  });
});

describe("the two tables", () => {
  // `org_portal.person_photos` is the TOGGLE key, not the table: a preceding "." or word character excludes it.
  const NAMES = /(?<![\w.])(person_photos|personPhotos|person_photo_designations|personPhotoDesignations)\b/;
  const ALLOWED = new Set([
    "src/lib/person-photos/store.ts", // the only writer
    "src/lib/person-photos/reader.ts", // the only other reader
    "src/lib/db/domain/person-photos.ts", // the Drizzle declaration
    "src/lib/dev-docs.ts", // the /developer module classification (table-name strings only)
  ]);

  it("are named only by store.ts, reader.ts, their declaration and the dev-docs classification", () => {
    const offenders = APP_FILES.filter((f) => NAMES.test(code(f)) && !ALLOWED.has(rel(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("are WRITTEN only by store.ts", () => {
    const writers = APP_FILES.filter((f) =>
      /\.(insert|update|delete)\(\s*(personPhotos|personPhotoDesignations)\b|(insert\s+into|update|delete\s+from)\s+person_photo(s|_designations)\b/i.test(code(f)),
    ).map(rel);
    expect(writers).toEqual(["src/lib/person-photos/store.ts"]);
  });

  it("nothing deletes from them at all (removal is removed_at / ended_at)", () => {
    for (const f of FEATURE_FILES) {
      expect(code(f), rel(f)).not.toMatch(/\.delete\(\s*(personPhotos|personPhotoDesignations)|delete\s+from\s+person_photo/i);
    }
  });
});

describe("blob writes", () => {
  it("getBlobStore().store( appears only in store.ts within the feature, twice, each with the literal audience \"private\"", () => {
    for (const f of FEATURE_FILES) {
      if (rel(f) === "src/lib/person-photos/store.ts") continue;
      expect(code(f), rel(f)).not.toMatch(/getBlobStore\(\)\s*\.\s*store\s*\(/);
    }
    const store = code(at("lib", "person-photos", "store.ts"));
    const calls = [...store.matchAll(/getBlobStore\(\)\s*\.\s*store\s*\(\s*\{([\s\S]*?)\}\s*\)/g)];
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call[1]).toMatch(/audience:\s*"private"/);
    expect(store).not.toMatch(/audience:\s*"public_site"/);
  });
});

describe("the retired people.photo_key", () => {
  it("no TypeScript reads people.photoKey or photoUpdatedAt, and no SQL string selects people.photo_key, outside the declaration", () => {
    const offenders = APP_FILES.filter((f) => rel(f) !== "src/lib/db/domain/people.ts")
      .filter((f) => /\bpeople\.photoKey\b|\bphotoUpdatedAt\b|\bpeople\.photo_updated_at\b|\b(p|pe|people)\.photo_key\b/.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("the declaration stays, marked RETIRED, until 0079 removes the column and it together (F334)", () => {
    const people = readFileSync(at("lib", "db", "domain", "people.ts"), "utf8");
    expect(people).toMatch(/photoKey/);
    expect(people).toMatch(/RETIRED/);
  });
});

describe("no new enumerable surface (DECISION-040)", () => {
  it("the feature adds no route handler", () => {
    const routes = [...walk(at("lib", "person-photos")), ...(existsSync(PHOTOS_PAGE_DIR) ? walk(PHOTOS_PAGE_DIR) : [])].filter((f) => /(^|\/)route\.ts$/.test(rel(f)));
    expect(routes.map(rel)).toEqual([]);
  });

  it("uses no platform (RLS-bypassing) connection", () => {
    for (const f of FEATURE_FILES) expect(code(f), rel(f)).not.toMatch(/getPlatformDb/);
  });

  it("presby_person_public_photo_status is named only in reader.ts (the wrapper is the one door to the owner-only core)", () => {
    const named = APP_FILES.filter((f) => /presby_person_public_photo(_status)?\b/.test(code(f))).map(rel);
    expect(named).toEqual(["src/lib/person-photos/reader.ts"]);
  });

  it("no app code calls the owner-only core presby_person_public_photo( directly", () => {
    for (const f of APP_FILES) expect(code(f), rel(f)).not.toMatch(/presby_person_public_photo\s*\(/);
  });
});

describe("listing is a read, never a write", () => {
  it("the feature never writes staff_positions, officer_terms or group_memberships, nor imports their tables", () => {
    for (const f of FEATURE_FILES) {
      const text = code(f);
      expect(text, rel(f)).not.toMatch(/(insert\s+into|update|delete\s+from)\s+(staff_positions|officer_terms|group_memberships)\b/i);
      expect(text, rel(f)).not.toMatch(/\b(staffPositions|officerTerms|groupMemberships)\b/);
    }
  });
});

describe("actions.ts", () => {
  it("holds no db. call and imports no database module", () => {
    const actions = code(path.join(PHOTOS_PAGE_DIR, "actions.ts"));
    expect(actions).not.toMatch(/\bdb\.|@\/lib\/db\b|getPlatformDb/);
  });
});

describe("the directory query", () => {
  const directory = code(at("lib", "directory.ts"));

  it("calls presby_person_directory_photo exactly once (the zero-photo path stays ONE statement), and selects no other photo column", () => {
    expect(directory.match(/presby_person_directory_photo\s*\(/g)).toHaveLength(1);
    expect(directory).not.toMatch(/\bphoto_key\b|\bp\.photo_|hide_photo/);
  });

  it("carries the THUMBNAIL key, named so nobody mistakes it for a master", () => {
    expect(directory).toMatch(/photoThumbKey/);
    expect(directory).toMatch(/dph\.thumb_key/);
    expect(directory).not.toMatch(/dph\.image_key/);
  });
});
