import { describe, expect, it } from "vitest";
import {
  buildOrgTree,
  orgFiltersToQuery,
  parseOrgFilters,
  type OrgFilters,
  type OrgNode,
} from "./org-tree";

const NONE: OrgFilters = { q: "", type: null, status: null, unbranded: false };

function org(p: Partial<OrgNode> & { id: string; name: string }): OrgNode {
  return {
    organizationType: "congregation",
    platformStatus: "managed",
    lifecycleStatus: "active",
    parentId: null,
    hasBrand: false,
    brandUpdatedAt: null,
    ...p,
  };
}

const SYNOD = org({ id: "s", name: "Synod of the Lakes", organizationType: "synod" });
const PRES = org({ id: "p", name: "Presbytery of the Fells", organizationType: "presbytery", parentId: "s" });
const PRES2 = org({ id: "p2", name: "Another Presbytery", organizationType: "presbytery", parentId: "s" });
const C1 = org({ id: "c1", name: "Wrenfield", parentId: "p" });
const C2 = org({ id: "c2", name: "Alder Creek", parentId: "p", hasBrand: true });
const LONE = org({ id: "c3", name: "Halloway" });
const FIXTURE = [C1, LONE, PRES, SYNOD, C2, PRES2];

const ids = (r: { rows: { org: OrgNode }[] }) => r.rows.map((x) => x.org.id);

describe("buildOrgTree — shape", () => {
  it("nests children under parents; roots by type rank then name; siblings by name", () => {
    const r = buildOrgTree(FIXTURE, NONE);
    // synod root first (rank), then the unaffiliated congregation root.
    expect(ids(r)).toEqual(["s", "p2", "p", "c2", "c1", "c3"]);
    expect(r.rows.map((x) => x.depth)).toEqual([0, 1, 1, 2, 2, 0]);
  });

  it("treats an unknown parent as a root and a self-parent as a root", () => {
    const orphan = org({ id: "o", name: "Orphan", parentId: "missing" });
    const selfie = org({ id: "x", name: "Selfie", parentId: "x" });
    const r = buildOrgTree([orphan, selfie], NONE);
    expect(ids(r)).toEqual(["o", "x"]);
    expect(r.rows.every((x) => x.depth === 0)).toBe(true);
  });

  it("terminates on a cycle and keeps every row", () => {
    const a = org({ id: "a", name: "A", parentId: "b" });
    const b = org({ id: "b", name: "B", parentId: "a" });
    const r = buildOrgTree([a, b], NONE);
    expect(ids(r).sort()).toEqual(["a", "b"]);
    expect(r.totalCount).toBe(2);
  });

  it("keeps a cycle remnant reachable from a real root", () => {
    const a = org({ id: "a", name: "A", parentId: "b" });
    const b = org({ id: "b", name: "B", parentId: "c" });
    const c = org({ id: "c", name: "C", parentId: "a" });
    const ok = org({ id: "ok", name: "Fine" });
    const r = buildOrgTree([a, b, c, ok], NONE);
    expect(ids(r).sort()).toEqual(["a", "b", "c", "ok"]);
  });

  it("sorts case-folded and NFC-normalised", () => {
    const e1 = org({ id: "1", name: "Église" }); // precomposed
    const e2 = org({ id: "2", name: "Église B" }); // decomposed
    const z = org({ id: "3", name: "zeta" });
    const a = org({ id: "4", name: "Alpha" });
    const r = buildOrgTree([z, e2, e1, a], NONE);
    expect(ids(r)).toEqual(["4", "1", "2", "3"]);
  });

  it("summarises direct children by type from the unfiltered tree", () => {
    const r = buildOrgTree(FIXTURE, NONE);
    const by = Object.fromEntries(r.rows.map((x) => [x.org.id, x.childSummary]));
    expect(by.s).toBe("2 presbyteries");
    expect(by.p).toBe("2 congregations");
    expect(by.c1).toBeNull();
    const mixed = buildOrgTree(
      [PRES, C1, org({ id: "n", name: "New", organizationType: "new_worshiping_community", parentId: "p" }), org({ id: "d", name: "Deep", parentId: "p" })],
      NONE,
    );
    expect(mixed.rows.find((x) => x.org.id === "p")!.childSummary).toBe(
      "2 congregations, 1 new worshiping community",
    );
  });

  it("reports the child summary from the unfiltered tree even when filtered", () => {
    const r = buildOrgTree(FIXTURE, { ...NONE, q: "wrenfield" });
    expect(r.rows.find((x) => x.org.id === "p")!.childSummary).toBe("2 congregations");
  });
});

describe("buildOrgTree — filters", () => {
  it("shows ancestors of a match, dimmed (isMatch false), match emphasised", () => {
    const r = buildOrgTree(FIXTURE, { ...NONE, q: "WRENFIELD" });
    expect(ids(r)).toEqual(["s", "p", "c1"]);
    expect(r.rows.map((x) => x.isMatch)).toEqual([false, false, true]);
    expect(r.matchCount).toBe(1);
    expect(r.totalCount).toBe(6);
  });

  it("filters by type and by platform status", () => {
    const t = buildOrgTree(FIXTURE, { ...NONE, type: "presbytery" });
    expect(t.rows.filter((x) => x.isMatch).map((x) => x.org.id).sort()).toEqual(["p", "p2"]);
    expect(ids(t)).toContain("s");
    const unmanaged = org({ id: "u", name: "Quiet", platformStatus: "unmanaged", parentId: "p" });
    const s = buildOrgTree([...FIXTURE, unmanaged], { ...NONE, status: "unmanaged" });
    expect(ids(s)).toEqual(["s", "p", "u"]);
  });

  it("combines unbranded with other filters (AND)", () => {
    const r = buildOrgTree(FIXTURE, { ...NONE, unbranded: true, type: "congregation" });
    expect(r.rows.filter((x) => x.isMatch).map((x) => x.org.id).sort()).toEqual(["c1", "c3"]);
    expect(r.unbrandedCount).toBe(5);
  });

  it("matches % and _ literally (no LIKE wildcards)", () => {
    const pct = org({ id: "pc", name: "100% Hope" });
    const und = org({ id: "un", name: "Under_score" });
    expect(ids(buildOrgTree([pct, und, C1], { ...NONE, q: "%" }))).toEqual(["pc"]);
    expect(ids(buildOrgTree([pct, und, C1], { ...NONE, q: "_" }))).toEqual(["un"]);
  });

  it("matches NFC-normalised and case-folded", () => {
    const e = org({ id: "e", name: "Église Reformée" });
    expect(ids(buildOrgTree([e], { ...NONE, q: "église" }))).toEqual(["e"]);
  });

  it("returns no rows and matchCount 0 when nothing matches", () => {
    const r = buildOrgTree(FIXTURE, { ...NONE, q: "zzz" });
    expect(r.rows).toEqual([]);
    expect(r.matchCount).toBe(0);
    expect(r.truncated).toBe(false);
  });

  it("filters inside a cycle without looping", () => {
    const a = org({ id: "a", name: "A", parentId: "b" });
    const b = org({ id: "b", name: "B", parentId: "a" });
    expect(buildOrgTree([a, b], { ...NONE, q: "b" }).matchCount).toBe(1);
  });
});

describe("buildOrgTree — cap", () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    org({ id: `m${String(i).padStart(2, "0")}`, name: `Church ${String(i).padStart(2, "0")}` }),
  );
  it("drops rows past the cap and says so", () => {
    const r = buildOrgTree(many, NONE, { cap: 5 });
    expect(r.rows).toHaveLength(5);
    expect(r.truncated).toBe(true);
    expect(r.matchCount).toBe(12);
  });
  it("does not truncate at exactly the cap", () => {
    expect(buildOrgTree(many, NONE, { cap: 12 }).truncated).toBe(false);
  });
  it("defaults to 500", () => {
    const big = Array.from({ length: 501 }, (_, i) => org({ id: `b${i}`, name: `B${i}` }));
    const r = buildOrgTree(big, NONE);
    expect(r.rows).toHaveLength(500);
    expect(r.truncated).toBe(true);
  });
});

describe("parseOrgFilters", () => {
  it("allow-lists type and status; unknown values are ignored", () => {
    expect(parseOrgFilters({ type: "bogus", status: "nonsense" })).toEqual(NONE);
    expect(parseOrgFilters({ type: "synod'; drop table--", status: "managed" })).toEqual({
      ...NONE,
      status: "managed",
    });
    expect(parseOrgFilters({ type: "congregation", status: "invited" })).toMatchObject({
      type: "congregation",
      status: "invited",
    });
  });
  it("takes the first value of an array param", () => {
    expect(parseOrgFilters({ q: ["one", "two"], type: ["presbytery", "synod"] })).toMatchObject({
      q: "one",
      type: "presbytery",
    });
  });
  it("trims, NFC-normalises and caps q at 100 characters", () => {
    expect(parseOrgFilters({ q: "  hi  " }).q).toBe("hi");
    expect(parseOrgFilters({ q: "é" }).q).toBe("é");
    expect(parseOrgFilters({ q: "x".repeat(300) }).q).toHaveLength(100);
  });
  it("accepts filter=unbranded only", () => {
    expect(parseOrgFilters({ filter: "unbranded" }).unbranded).toBe(true);
    expect(parseOrgFilters({ filter: "other" }).unbranded).toBe(false);
  });
});

describe("orgFiltersToQuery", () => {
  it("is empty with no filters", () => {
    expect(orgFiltersToQuery(NONE)).toBe("");
  });
  it("puts filter FIRST so ?filter=unbranded stays the bookmarked form", () => {
    expect(orgFiltersToQuery({ ...NONE, unbranded: true })).toBe("?filter=unbranded");
    expect(
      orgFiltersToQuery({ q: "al", type: "congregation", status: "managed", unbranded: true }),
    ).toBe("?filter=unbranded&q=al&type=congregation&status=managed");
  });
  it("round-trips through parseOrgFilters", () => {
    const f: OrgFilters = { q: "a & b%", type: "presbytery", status: "invited", unbranded: true };
    const sp = Object.fromEntries(new URLSearchParams(orgFiltersToQuery(f).slice(1)));
    expect(parseOrgFilters(sp)).toEqual(f);
  });
});
