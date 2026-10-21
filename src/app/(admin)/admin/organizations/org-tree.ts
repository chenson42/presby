/**
 * Pure helpers for the `/admin/organizations` council tree (Batch C, R14).
 *
 * No database import, no `server-only`: the page does the one read and hands
 * the flat rows here. Three rules this file exists to keep:
 *
 * 1. DISPLAY ONLY. The tree is built from `parent_id`, the trigger-maintained
 *    cache of `organization_affiliations` (D19). `path` is never read or
 *    parsed, nothing is written, no affiliation function is called, and no
 *    link or action is chosen by a row's position in the tree (Two
 *    Hierarchies Intersect Nowhere).
 * 2. NO TRUST IN THE CACHE. A parent id that points nowhere makes a root; a
 *    cycle or a self-parent cannot recurse forever and cannot hide a row
 *    (a visited set, then every unvisited row is appended as an extra root).
 * 3. NO SQL. Filters are matched in memory, so there is no LIKE pattern to
 *    escape, and `type` / `status` are allow-listed and never reach a `pg`
 *    enum comparison.
 */

export const ORG_TYPES = [
  "general_assembly",
  "synod",
  "presbytery",
  "congregation",
  "new_worshiping_community",
] as const;
export type OrgTypeKey = (typeof ORG_TYPES)[number];

export const PLATFORM_STATUSES = ["managed", "unmanaged", "invited"] as const;
export type PlatformStatusKey = (typeof PLATFORM_STATUSES)[number];

export const MAX_Q_LENGTH = 100;
export const DEFAULT_ROW_CAP = 500;

export interface OrgNode {
  id: string;
  name: string;
  organizationType: string;
  platformStatus: string;
  lifecycleStatus: string;
  parentId: string | null;
  hasBrand: boolean;
  brandUpdatedAt: Date | null;
}

export interface OrgFilters {
  q: string;
  type: OrgTypeKey | null;
  status: PlatformStatusKey | null;
  unbranded: boolean;
}

export interface TreeRow {
  org: OrgNode;
  depth: number;
  /** True when the row satisfies every active filter (always true unfiltered). */
  isMatch: boolean;
  /** "12 congregations", from the UNFILTERED tree; null for a leaf. */
  childSummary: string | null;
}

export interface OrgTreeResult {
  rows: TreeRow[];
  matchCount: number;
  totalCount: number;
  unbrandedCount: number;
  truncated: boolean;
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const COLLATOR = new Intl.Collator("en", { sensitivity: "base" });

function fold(s: string): string {
  return s.normalize("NFC").toLocaleLowerCase("en");
}

function typeRank(t: string): number {
  const i = (ORG_TYPES as readonly string[]).indexOf(t);
  return i === -1 ? ORG_TYPES.length : i;
}

export function parseOrgFilters(sp: SearchParams): OrgFilters {
  const rawType = first(sp.type);
  const rawStatus = first(sp.status);
  const rawQ = first(sp.q) ?? "";
  return {
    q: rawQ.normalize("NFC").trim().slice(0, MAX_Q_LENGTH).trim(),
    type: (ORG_TYPES as readonly string[]).includes(rawType ?? "")
      ? (rawType as OrgTypeKey)
      : null,
    status: (PLATFORM_STATUSES as readonly string[]).includes(rawStatus ?? "")
      ? (rawStatus as PlatformStatusKey)
      : null,
    unbranded: first(sp.filter) === "unbranded",
  };
}

/** "" or "?filter=unbranded&q=…&type=…&status=…" — `filter` FIRST so the
 * bookmarked `?filter=unbranded` form is unchanged. */
export function orgFiltersToQuery(f: OrgFilters): string {
  const p = new URLSearchParams();
  if (f.unbranded) p.set("filter", "unbranded");
  if (f.q) p.set("q", f.q);
  if (f.type) p.set("type", f.type);
  if (f.status) p.set("status", f.status);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function hasActiveFilters(f: OrgFilters): boolean {
  return f.q !== "" || f.type !== null || f.status !== null || f.unbranded;
}

const SUMMARY_LABELS: Record<string, [string, string]> = {
  general_assembly: ["general assembly", "general assemblies"],
  synod: ["synod", "synods"],
  presbytery: ["presbytery", "presbyteries"],
  congregation: ["congregation", "congregations"],
  new_worshiping_community: [
    "new worshiping community",
    "new worshiping communities",
  ],
};

function summarize(children: ReadonlyArray<OrgNode>): string | null {
  if (children.length === 0) return null;
  const counts = new Map<string, number>();
  for (const c of children) {
    counts.set(c.organizationType, (counts.get(c.organizationType) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => typeRank(a[0]) - typeRank(b[0]))
    .map(([type, n]) => {
      const [one, many] = SUMMARY_LABELS[type] ?? ["organization", "organizations"];
      return `${n} ${n === 1 ? one : many}`;
    })
    .join(", ");
}

function matches(o: OrgNode, f: OrgFilters, q: string): boolean {
  if (f.type && o.organizationType !== f.type) return false;
  if (f.status && o.platformStatus !== f.status) return false;
  if (f.unbranded && o.hasBrand) return false;
  if (q && !fold(o.name).includes(q)) return false;
  return true;
}

export function buildOrgTree(
  rows: ReadonlyArray<OrgNode>,
  filters: OrgFilters,
  opts: { cap?: number } = {},
): OrgTreeResult {
  const cap = opts.cap ?? DEFAULT_ROW_CAP;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const byName = (a: OrgNode, b: OrgNode) =>
    COLLATOR.compare(a.name.normalize("NFC"), b.name.normalize("NFC")) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const byRankThenName = (a: OrgNode, b: OrgNode) =>
    typeRank(a.organizationType) - typeRank(b.organizationType) || byName(a, b);

  // A parent that is unknown or the row itself makes the row a root.
  const children = new Map<string, OrgNode[]>();
  const roots: OrgNode[] = [];
  for (const r of rows) {
    if (r.parentId && r.parentId !== r.id && byId.has(r.parentId)) {
      const list = children.get(r.parentId);
      if (list) list.push(r);
      else children.set(r.parentId, [r]);
    } else {
      roots.push(r);
    }
  }
  roots.sort(byRankThenName);
  for (const list of children.values()) list.sort(byName);

  // Iterative DFS with a visited set: a cycle cannot loop and cannot recurse
  // the stack. Cycle remnants (never reached from a root) are appended as
  // extra roots so a bad cache can never silently hide a row.
  const ordered: { org: OrgNode; depth: number }[] = [];
  const treeParent = new Map<string, string | null>();
  const visited = new Set<string>();
  const walk = (start: OrgNode) => {
    const stack: { org: OrgNode; depth: number; parent: string | null }[] = [
      { org: start, depth: 0, parent: null },
    ];
    while (stack.length > 0) {
      const { org, depth, parent } = stack.pop()!;
      if (visited.has(org.id)) continue;
      visited.add(org.id);
      treeParent.set(org.id, parent);
      ordered.push({ org, depth });
      const kids = children.get(org.id) ?? [];
      for (let i = kids.length - 1; i >= 0; i--) {
        if (!visited.has(kids[i].id)) {
          stack.push({ org: kids[i], depth: depth + 1, parent: org.id });
        }
      }
    }
  };
  for (const r of roots) walk(r);
  for (const r of [...rows].sort(byRankThenName)) {
    if (!visited.has(r.id)) walk(r);
  }

  const q = fold(filters.q);
  const filtered = hasActiveFilters(filters);
  const matchIds = new Set<string>();
  for (const r of rows) if (!filtered || matches(r, filters, q)) matchIds.add(r.id);

  const keep = new Set<string>(matchIds);
  if (filtered) {
    for (const id of matchIds) {
      let p = treeParent.get(id) ?? null;
      while (p && !keep.has(p)) {
        keep.add(p);
        p = treeParent.get(p) ?? null;
      }
    }
  }

  const all: TreeRow[] = ordered
    .filter((o) => keep.has(o.org.id))
    .map((o) => ({
      org: o.org,
      depth: o.depth,
      isMatch: matchIds.has(o.org.id),
      childSummary: summarize(children.get(o.org.id) ?? []),
    }));

  return {
    rows: all.length > cap ? all.slice(0, cap) : all,
    matchCount: matchIds.size,
    totalCount: rows.length,
    unbrandedCount: rows.filter((r) => !r.hasBrand).length,
    truncated: all.length > cap,
  };
}
