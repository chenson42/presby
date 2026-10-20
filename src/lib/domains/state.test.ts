/**
 * state.ts pinned to the database (Phase 3 "state-table <-> trigger agreement
 * test"; Batch 1a-ii gate). The trigger in drizzle/0057 holds the legal-edge
 * table between `-- BEGIN LEGAL EDGES` and `-- END LEGAL EDGES`; this file
 * parses it and fails if `state.ts` disagrees in either direction on a
 * (from, to, purpose-scope) triple. It also pins the state enumerations to the
 * Drizzle model and the audit-key mapping to the keys audit.ts declares.
 *
 * Pure: no database.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import "@/lib/db/schema";
import {
  ORGANIZATION_DOMAIN_HOLDING_STATES,
  ORGANIZATION_DOMAIN_STATES,
  ORGANIZATION_DOMAIN_TERMINAL_STATES,
} from "@/lib/db/domain/domains";
import {
  DOMAIN_STATES,
  EDGES,
  HOLDING_STATES,
  TERMINAL_STATES,
  auditKeyNameFor,
  edgePairs,
  isHolding,
  isTerminal,
  nextState,
  type DomainEvent,
  type DomainPurpose,
  type DomainState,
} from "./state";

vi.mock("server-only", () => ({}));

const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../drizzle/0057_presby_org_domains.sql", import.meta.url)),
  "utf8",
);
const AUDIT_SOURCE = readFileSync(fileURLToPath(new URL("../audit.ts", import.meta.url)), "utf8");

function triggerEdges() {
  const block = MIGRATION.match(/-- BEGIN LEGAL EDGES[\s\S]*?-- END LEGAL EDGES/);
  if (!block) throw new Error("no LEGAL EDGES block in 0057");
  return [...block[0].matchAll(/\('(\w+)',\s*'(\w+)',\s*(null|'(\w+)')\)/g)].map((m) => ({
    from: m[1],
    to: m[2],
    scope: (m[4] ?? null) as DomainPurpose | null,
  }));
}

const key = (x: { from: string; to: string; scope: string | null }) => `${x.from}>${x.to}|${x.scope ?? "*"}`;

describe("state.ts agrees with the trigger's legal-edge table", () => {
  const db = triggerEdges();

  it("the parser reads the 25 edges (not vacuous)", () => {
    expect(db).toHaveLength(25);
  });

  it("every distinct (from, to, scope) pair is identical in both directions", () => {
    const app = edgePairs().map(key).sort();
    const trg = db.map(key).sort();
    expect(app).toEqual(trg);
  });

  it("no (from, event) is ambiguous for one purpose", () => {
    for (const purpose of ["web", "mail"] as const) {
      const seen = new Map<string, DomainState>();
      for (const x of EDGES) {
        if (x.scope !== null && x.scope !== purpose) continue;
        const k = `${x.from}|${x.event}`;
        const prior = seen.get(k);
        expect(prior === undefined || prior === x.to, `${purpose} ${k}`).toBe(true);
        seen.set(k, x.to);
      }
    }
  });

  it("nextState follows the table and is purpose-aware", () => {
    expect(nextState("pending", "proof_ok", "web")).toBe("verified");
    expect(nextState("pending", "proof_ok", "mail")).toBe("verified");
    expect(nextState("lapsed", "remove", "web")).toBe("parked");
    expect(nextState("lapsed", "remove", "mail")).toBe("released");
    expect(nextState("lapsed", "force_release", "web")).toBe("release_pending");
    expect(nextState("lapsed", "force_release", "mail")).toBe("released");
  });

  it("a mail row can never take a web-only edge", () => {
    expect(nextState("verified", "attach_start", "mail")).toBeNull();
    expect(nextState("lapsed", "grace_elapsed", "mail")).toBeNull();
    expect(nextState("parked", "reconnect", "mail")).toBeNull();
  });

  it("refuses shortcuts the UI must never be able to take (A15)", () => {
    expect(nextState("pending", "live_ok", "web")).toBeNull();
    expect(nextState("pending", "attach_start", "web")).toBeNull();
    expect(nextState("verified", "live_ok", "web")).toBeNull();
    expect(nextState("attach_pending", "live_ok", "web")).toBeNull();
    expect(nextState("live", "proof_ok", "web")).toBeNull();
    expect(nextState("parked", "proof_ok", "web")).toBeNull();
  });

  it("terminal states have no outgoing edge, and nothing enters pending", () => {
    for (const t of TERMINAL_STATES) {
      expect(EDGES.filter((x) => x.from === t)).toEqual([]);
    }
    expect(EDGES.filter((x) => x.to === "pending")).toEqual([]);
  });
});

describe("the enumerations match the Drizzle model", () => {
  it("states, holding states and terminal states", () => {
    expect([...DOMAIN_STATES]).toEqual([...ORGANIZATION_DOMAIN_STATES]);
    expect([...HOLDING_STATES]).toEqual([...ORGANIZATION_DOMAIN_HOLDING_STATES]);
    expect([...TERMINAL_STATES]).toEqual([...ORGANIZATION_DOMAIN_TERMINAL_STATES]);
  });

  it("isHolding / isTerminal", () => {
    expect(isHolding("verified")).toBe(true);
    expect(isHolding("pending")).toBe(false);
    expect(isHolding("released")).toBe(false);
    expect(isTerminal("expired")).toBe(true);
    expect(isTerminal("parked")).toBe(false);
  });
});

describe("one explicit audit key per edge (R8)", () => {
  const declared = new Map(
    [...AUDIT_SOURCE.matchAll(/^\s*(DOMAIN_[A-Z_]+):\s*"(domain\.[a-z_]+)",/gm)].map((m) => [m[1], m[2]]),
  );

  it("audit.ts declares the 16 domain.* keys the design lists", () => {
    expect([...declared.values()].sort()).toEqual(
      [
        "domain.claimed",
        "domain.proof_verified",
        "domain.attach_requested",
        "domain.attached",
        "domain.live",
        "domain.live_lost",
        "domain.lapsed",
        "domain.recovered",
        "domain.parked",
        "domain.reconnected",
        "domain.release_requested",
        "domain.released",
        "domain.expired",
        "domain.canonical_changed",
        "domain.hold_set",
        "domain.hold_cleared",
      ].sort(),
    );
  });

  it("every edge maps to a declared key", () => {
    for (const x of EDGES) {
      const name = auditKeyNameFor(x.from, x.event, x.to);
      expect(declared.has(name), `${x.from} -${x.event}-> ${x.to} => ${name}`).toBe(true);
    }
  });

  it("the mapping reads as the design says", () => {
    const f = (from: DomainState, event: DomainEvent, to: DomainState) => auditKeyNameFor(from, event, to);
    expect(f("pending", "proof_ok", "verified")).toBe("DOMAIN_PROOF_VERIFIED");
    expect(f("lapsed", "proof_ok", "verified")).toBe("DOMAIN_RECOVERED");
    expect(f("pending", "expire", "expired")).toBe("DOMAIN_EXPIRED");
    expect(f("verified", "attach_start", "attach_pending")).toBe("DOMAIN_ATTACH_REQUESTED");
    expect(f("attach_pending", "attach_ok", "attached")).toBe("DOMAIN_ATTACHED");
    expect(f("attached", "live_ok", "live")).toBe("DOMAIN_LIVE");
    expect(f("live", "live_lost", "attached")).toBe("DOMAIN_LIVE_LOST");
    expect(f("live", "proof_lost", "lapsed")).toBe("DOMAIN_LAPSED");
    expect(f("live", "remove", "parked")).toBe("DOMAIN_PARKED");
    expect(f("pending", "remove", "released")).toBe("DOMAIN_RELEASED");
    expect(f("live", "force_release", "release_pending")).toBe("DOMAIN_RELEASE_REQUESTED");
    expect(f("lapsed", "grace_elapsed", "release_pending")).toBe("DOMAIN_RELEASE_REQUESTED");
    expect(f("parked", "reconnect", "verified")).toBe("DOMAIN_RECONNECTED");
    expect(f("release_pending", "detach_ok", "released")).toBe("DOMAIN_RELEASED");
    expect(f("pending", "force_release", "released")).toBe("DOMAIN_RELEASED");
  });
});
