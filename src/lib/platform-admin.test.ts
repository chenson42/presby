/**
 * Tests for the session-claim half of the two platform predicates.
 *
 * `readIsPlatformAdmin` is a four-line select and is exercised against the real
 * database; what is worth pinning here is `sessionCanAccessAdmin`, because
 * THREE places have to agree on it — src/proxy.ts at the Edge, /launch when it
 * routes a zero-organization holder straight to /admin, and /home (DECISION-124
 * — this used to be /orgs) when it renders the Admin card. A disagreement
 * sends a user to a page the Edge bounces to /access-pending, which reads as
 * a broken login rather than as a permissions problem.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn() },
}));

import { describe, expect, it, vi } from "vitest";
import { ADMIN_ROLE, FEATURES } from "@/lib/permissions";
import { sessionCanAccessAdmin } from "./platform-admin";

describe("sessionCanAccessAdmin", () => {
  it("admits a holder of ADMIN_ROLE — the proxy's own first check", () => {
    expect(sessionCanAccessAdmin({ roles: [ADMIN_ROLE], features: [] })).toBe(
      true,
    );
  });

  it("admits a holder of the admin.dashboard feature without the role", () => {
    expect(
      sessionCanAccessAdmin({
        roles: ["member"],
        features: [FEATURES.ADMIN_DASHBOARD],
      }),
    ).toBe(true);
  });

  it("refuses a user with neither", () => {
    expect(
      sessionCanAccessAdmin({ roles: ["member"], features: ["some.other"] }),
    ).toBe(false);
  });

  it("refuses a user holding a different admin.* feature", () => {
    // PROTECTION_RULES gates /admin on ADMIN_DASHBOARD specifically. Holding
    // admin.users without it does not get you through the front door.
    expect(
      sessionCanAccessAdmin({ roles: [], features: [FEATURES.ADMIN_USERS] }),
    ).toBe(false);
  });

  it("returns false rather than undefined for missing claims", () => {
    // A session projected before roles/features existed, or a token mid-shape-
    // change. `undefined` would be falsy at the call site but would break the
    // strict boolean the destination matrix takes.
    expect(sessionCanAccessAdmin({})).toBe(false);
    expect(sessionCanAccessAdmin({ roles: null, features: null })).toBe(false);
  });
});
