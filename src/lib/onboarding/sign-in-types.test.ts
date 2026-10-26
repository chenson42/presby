/**
 * The pure vocabularies and derivations of the congregation's sign-in
 * invitation (Community Increment 2b, Batch B2, T-10). Two jobs:
 *
 *   1. PIN every closed list and limit to drizzle/0065 section 12, by reading
 *      the migration's text (the `ROLL_DECISION_REFUSALS` pattern): a literal
 *      added to SQL and not here, or the reverse, fails the build.
 *   2. TEST the derivations that exist only in TypeScript and only for display:
 *      `connectOutlook`, `deriveSignInMarker`, `deriveSessionRowState`.
 *
 * Pure file reads and pure functions: no database, always runs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONNECT_OUTLOOKS,
  MEMBERSHIP_STANDINGS,
  SESSION_ROW_STATES,
  SIGN_IN_ACK_REASONS,
  SIGN_IN_BLOCK_OUTCOMES,
  SIGN_IN_CONNECTED_VIA,
  SIGN_IN_INVITATION_LIMITS,
  SIGN_IN_ISSUE_REFUSALS,
  SIGN_IN_REFUSALS,
  SIGN_IN_RESEND_ONLY_REFUSALS,
  SIGN_IN_REVOKE_OUTCOMES,
  SIGN_IN_STATES,
  REVOKE_ALL_SCOPES,
  assertNever,
  connectOutlook,
  deriveSessionRowState,
  deriveSignInMarker,
  sessionRowAction,
  type ConnectOutlookInput,
} from "./sign-in-types";

const ROOT = path.resolve(__dirname, "../../..");
const MIGRATION = readFileSync(path.join(ROOT, "drizzle/0065_presby_sign_in_and_connect.sql"), "utf8");

/** The text of one `create or replace function <name>(` body, up to the next one. */
function functionBody(name: string): string {
  const start = MIGRATION.indexOf(`create or replace function ${name}(`);
  expect(start, `${name} is defined in 0065`).toBeGreaterThanOrEqual(0);
  const next = MIGRATION.indexOf("create or replace function", start + 10);
  return MIGRATION.slice(start, next === -1 ? undefined : next);
}

const literals = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m[1]!);
const unique = (xs: string[]) => [...new Set(xs)].sort();
const outcomeLiterals = (text: string) => unique(literals(text, /outcome := '([a-z_]+)'/g));

describe("the refusal vocabulary is the migration's, in both directions", () => {
  const check = outcomeLiterals(functionBody("presby_sign_in__check"));
  const issue = outcomeLiterals(functionBody("presby_issue_sign_in_invitation"));
  const resend = outcomeLiterals(functionBody("presby_resend_sign_in_invitation"));
  const revoke = outcomeLiterals(functionBody("presby_revoke_sign_in_invitation"));
  // The standing core's own-organization refusals pass through `outcome := v_st.refusal`.
  const CORE_PASS_THROUGH = ["person_deceased", "person_merged", "membership_ended"];

  it("the check passes the standing core's three own-organization refusals through by name", () => {
    expect(functionBody("presby_sign_in__check")).toMatch(
      /v_st\.refusal in \('person_merged', 'person_deceased', 'membership_ended'\)/,
    );
    expect(functionBody("presby_sign_in__check")).toMatch(/outcome := v_st\.refusal/);
  });

  it("SIGN_IN_ISSUE_REFUSALS is every non-ok literal issue can return (its own, the check's, the core's)", () => {
    const expected = unique([...check, ...issue, ...CORE_PASS_THROUGH].filter((o) => o !== "ok"));
    expect([...SIGN_IN_ISSUE_REFUSALS].sort()).toEqual(expected);
  });

  it("SIGN_IN_RESEND_ONLY_REFUSALS is what resend returns that issue cannot", () => {
    const issueSide = new Set([...check, ...issue, ...CORE_PASS_THROUGH]);
    const resendOnly = resend.filter((o) => o !== "ok" && !issueSide.has(o));
    expect([...SIGN_IN_RESEND_ONLY_REFUSALS].sort()).toEqual(resendOnly);
  });

  it("every literal resend can return is in the refusal list, and the list is their union with issue's", () => {
    const all = unique([...check, ...issue, ...resend, ...CORE_PASS_THROUGH].filter((o) => o !== "ok"));
    expect([...SIGN_IN_REFUSALS].sort()).toEqual(all);
  });

  it("the lists do not overlap and carry no removed outcome (address_ambiguous and address_invalid are deleted)", () => {
    const issueSet = new Set<string>(SIGN_IN_ISSUE_REFUSALS);
    expect(SIGN_IN_RESEND_ONLY_REFUSALS.filter((o) => issueSet.has(o))).toEqual([]);
    expect(SIGN_IN_REFUSALS).not.toContain("address_ambiguous");
    expect(SIGN_IN_REFUSALS).not.toContain("address_invalid");
    expect(MIGRATION).not.toMatch(/outcome := 'address_(ambiguous|invalid)'/);
  });

  it("revoke returns exactly ok and not_open", () => {
    expect([...SIGN_IN_REVOKE_OUTCOMES].sort()).toEqual(revoke);
  });

  it("the acknowledgement reasons are the two the check can raise", () => {
    const reasons = unique(literals(functionBody("presby_sign_in__check"), /v_reasons \|\| '([a-z_]+)'::text/g));
    expect([...SIGN_IN_ACK_REASONS].sort()).toEqual(reasons);
  });
});

describe("the reader's vocabulary is the migration's", () => {
  const reader = functionBody("presby_sign_in_invitation_states");

  it("states", () => {
    const block = /case when k\.is_linked then 'signs_in'[\s\S]*?end\s+as st/.exec(reader);
    expect(block, "the state case expression").not.toBeNull();
    const found = unique([...block![0].matchAll(/(?:then|else) '([a-z_]+)'/g)].map((m) => m[1]!));
    expect([...SIGN_IN_STATES].sort()).toEqual(found);
  });

  it("block outcomes", () => {
    const block = /case s\.blocked_reason[\s\S]*?\bend\b/.exec(reader);
    expect(block, "the blocked outcome case").not.toBeNull();
    const found = unique([...block![0].matchAll(/then '([a-z_]+)'|else '([a-z_]+)'/g)].map((m) => (m[1] ?? m[2])!));
    expect([...SIGN_IN_BLOCK_OUTCOMES].sort()).toEqual(found);
  });

  it("connected_via", () => {
    const found = unique([...reader.matchAll(/'(invitation|sign_in)'::text/g)].map((m) => m[1]!));
    expect([...SIGN_IN_CONNECTED_VIA].sort()).toEqual(found);
  });
});

describe("the standing classifier's vocabulary is the migration's", () => {
  it("MEMBERSHIP_STANDINGS equals presby_membership_standing's results", () => {
    const body = functionBody("presby_membership_standing");
    const found = unique(literals(body, /then '([a-z_]+)'/g).concat(literals(body, /else '([a-z_]+)'/g)));
    expect([...MEMBERSHIP_STANDINGS].sort()).toEqual(found);
  });
});

describe("the limits are the SQL's literals (G9, R32)", () => {
  const issue = functionBody("presby_issue_sign_in_invitation");
  const resend = functionBody("presby_resend_sign_in_invitation");

  it("30 per organization, 30 per inviter, 3 per address, in a rolling 24 hours, in BOTH issue and resend", () => {
    for (const body of [issue, resend]) {
      const counts = [...body.matchAll(/\) >= (\d+)/g)].map((m) => Number(m[1]));
      expect(counts).toEqual([
        SIGN_IN_INVITATION_LIMITS.perOrganizationPer24h,
        SIGN_IN_INVITATION_LIMITS.perInviterPer24h,
        SIGN_IN_INVITATION_LIMITS.perAddressPer24h,
      ]);
      expect(body).toMatch(/interval '24 hours'/);
      // Org-origin rows only (a congregation's sends never spend the platform's budget, F198).
      expect([...body.matchAll(/i\.origin = 'org'/g)].length).toBeGreaterThanOrEqual(3);
    }
  });

  it("the resend cooldown is 5 minutes and a chain is capped at 5 resends", () => {
    expect(resend).toMatch(new RegExp(`interval '${SIGN_IN_INVITATION_LIMITS.resendCooldownMinutes} minutes'`));
    expect(resend).toMatch(new RegExp(`v_old\\.resend_count >= ${SIGN_IN_INVITATION_LIMITS.maxResendsPerChain}\\b`));
  });

  it("the expiry the application mints is the issue module's INVITATION_EXPIRY_DAYS (7)", () => {
    const issueSource = readFileSync(path.join(ROOT, "src/lib/onboarding/issue.ts"), "utf8");
    const m = /export const INVITATION_EXPIRY_DAYS = (\d+);/.exec(issueSource);
    expect(m, "INVITATION_EXPIRY_DAYS").not.toBeNull();
    expect(SIGN_IN_INVITATION_LIMITS.expiryDays).toBe(Number(m![1]));
  });
});

describe("the revoke-all scopes", () => {
  it("are exactly the two origins' levers", () => {
    expect([...REVOKE_ALL_SCOPES]).toEqual(["designations", "org_sent"]);
  });
});

// ---------------------------------------------------------------------------
// connectOutlook: display only, hedged, precedence pinned
// ---------------------------------------------------------------------------

const BASE: ConnectOutlookInput = {
  state: "none",
  hasAddress: true,
  standing: "listed",
  authorityBearing: false,
  addressShared: false,
  selfConnectEnabled: true,
  connectedVia: null,
};
const outlook = (over: Partial<ConnectOutlookInput>) => connectOutlook({ ...BASE, ...over });

describe("connectOutlook (R46: own-organization facts; a closed result)", () => {
  it("every result is one of the seven, and each is reachable", () => {
    const seen = new Set([
      outlook({ state: "signs_in" }),
      outlook({}),
      outlook({ authorityBearing: true }),
      outlook({ standing: "visitor" }),
      outlook({ addressShared: true }),
      outlook({ selfConnectEnabled: false }),
      outlook({ hasAddress: false }),
    ]);
    expect([...seen].sort()).toEqual([...CONNECT_OUTLOOKS].sort());
  });

  it("a connected person reads connected whatever else is true", () => {
    expect(outlook({ state: "signs_in", selfConnectEnabled: false, addressShared: true, standing: "visitor" })).toBe("connected");
  });

  it("an open (pending) or blocked invitation, or no address, reads none: the card's own state copy speaks", () => {
    expect(outlook({ state: "pending" })).toBe("none");
    expect(outlook({ state: "blocked" })).toBe("none");
    expect(outlook({ hasAddress: false })).toBe("none");
    expect(outlook({ hasAddress: false, standing: "visitor", addressShared: true })).toBe("none");
  });

  it("an authority-free, listed, unshared record with the toggle on is by_sign_in, in states none, expired and revoked", () => {
    for (const state of ["none", "expired", "revoked"] as const) expect(outlook({ state })).toBe("by_sign_in");
  });

  it("every non-visitor standing connects by sign-in (only a visitor is declined, 2b)", () => {
    for (const standing of ["listed", "staff_anchor", "inactive", "unclassified", null] as const) {
      expect(outlook({ standing })).toBe("by_sign_in");
    }
    expect(outlook({ standing: "visitor" })).toBe("visitor");
  });

  it("precedence, first match wins: toggle off, then a shared address, then a visitor, then authority", () => {
    const everything = { selfConnectEnabled: false, addressShared: true, standing: "visitor" as const, authorityBearing: true };
    expect(outlook(everything)).toBe("turned_off");
    expect(outlook({ ...everything, selfConnectEnabled: true })).toBe("shared_address");
    expect(outlook({ ...everything, selfConnectEnabled: true, addressShared: false })).toBe("visitor");
    expect(outlook({ ...everything, selfConnectEnabled: true, addressShared: false, standing: "listed" })).toBe("by_sign_in_second_factor");
  });

  it("an authority-bearing record is never promised a plain connection", () => {
    expect(outlook({ authorityBearing: true })).toBe("by_sign_in_second_factor");
  });
});

// ---------------------------------------------------------------------------
// markers and Session rows
// ---------------------------------------------------------------------------

const SENT = new Date("2026-10-20T12:00:00Z");
const facts = (state: Parameters<typeof deriveSignInMarker>[0]["state"], over = {}) => ({
  linked: false,
  state,
  sentAt: state === "none" || state === "revoked" ? null : SENT,
  delivery: "sent" as const,
  ...over,
});

describe("deriveSignInMarker", () => {
  const quiet = { holdsInertAuthority: false, hasAddress: true };
  const authority = { holdsInertAuthority: true, hasAddress: true };

  it("never marks a connected person", () => {
    expect(deriveSignInMarker(facts("signs_in", { linked: true }), authority)).toBeNull();
    expect(deriveSignInMarker(facts("pending", { linked: true }), authority)).toBeNull();
  });

  it("pending with a delivered or queued email reads 'sent {date}'", () => {
    for (const delivery of ["queued", "sent", "delivered", "unknown", "cancelled"] as const) {
      expect(deriveSignInMarker(facts("pending", { delivery }), quiet)).toEqual({ kind: "pending", sentAt: SENT });
    }
  });

  it("a bounced or failed email reads bounced", () => {
    expect(deriveSignInMarker(facts("pending", { delivery: "bounced" }), quiet)).toEqual({ kind: "bounced" });
    expect(deriveSignInMarker(facts("pending", { delivery: "failed" }), quiet)).toEqual({ kind: "bounced" });
  });

  it("expired reads expired", () => {
    expect(deriveSignInMarker(facts("expired"), quiet)).toEqual({ kind: "expired" });
  });

  it("none and revoked show only for a person who holds authority that is inert while unconnected (no marker on every member)", () => {
    for (const state of ["none", "revoked"] as const) {
      expect(deriveSignInMarker(facts(state), quiet)).toBeNull();
      expect(deriveSignInMarker(facts(state), authority)).toEqual({ kind: "not_connected", noEmail: false });
      expect(deriveSignInMarker(facts(state), { holdsInertAuthority: true, hasAddress: false })).toEqual({ kind: "not_connected", noEmail: true });
    }
  });

  it("blocked reads 'not connected yet': the person is unconnected and the card says why", () => {
    expect(deriveSignInMarker(facts("blocked"), quiet)).toEqual({ kind: "not_connected", noEmail: false });
    expect(deriveSignInMarker(facts("blocked"), { holdsInertAuthority: false, hasAddress: false })).toEqual({ kind: "not_connected", noEmail: true });
  });
});

describe("deriveSessionRowState / sessionRowAction", () => {
  it("covers each of the five states the hand-off names", () => {
    const rows = [
      deriveSessionRowState(facts("none"), { hasAddress: false }),
      deriveSessionRowState(facts("none"), { hasAddress: true }),
      deriveSessionRowState(facts("pending"), { hasAddress: true }),
      deriveSessionRowState(facts("expired"), { hasAddress: true }),
      deriveSessionRowState(facts("pending", { delivery: "bounced" }), { hasAddress: true }),
    ];
    expect(rows).toEqual(["no_email", "not_invited", "sent", "expired", "bounced"]);
    expect([...new Set(rows)].sort()).toEqual([...SESSION_ROW_STATES].sort());
  });

  it("a revoked or blocked seat reads as not invited (or no email) and offers the card", () => {
    expect(deriveSessionRowState(facts("revoked"), { hasAddress: true })).toBe("not_invited");
    expect(deriveSessionRowState(facts("blocked"), { hasAddress: true })).toBe("not_invited");
    expect(deriveSessionRowState(facts("revoked"), { hasAddress: false })).toBe("no_email");
  });

  it("'Invite' only when nothing is out and there is an address; 'Open' everywhere else", () => {
    expect(sessionRowAction("not_invited")).toBe("invite");
    for (const s of ["no_email", "sent", "expired", "bounced"] as const) expect(sessionRowAction(s)).toBe("open");
  });
});

describe("assertNever", () => {
  it("throws, naming the value", () => {
    expect(() => assertNever("x" as never, "state")).toThrow(/Unhandled state: x/);
  });
});
