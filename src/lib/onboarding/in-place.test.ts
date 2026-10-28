/**
 * `listInvitationsForAccount` (Community Increment 2b, Batch B2, T-9/T-7; R45,
 * E-20), database mocked. Who is listed is the definer's (a proven, active
 * account; the invited address equals the account's; open rows only) and is
 * proven against Postgres in `accept-in-place.db.test.ts` and
 * `accept-in-place.lib.db.test.ts`. Pinned here: the call, the closed result
 * shape, the unknown-purpose guard, and that a database error THROWS (the page
 * turns it into the N5 line, never a silent empty list).
 */
// Load schema.ts first: a pre-existing circular import (org.ts -> schema.ts ->
// domain/index.ts -> authz.ts -> org.ts) breaks when a domain file is the FIRST
// module in the cycle to load (the same line status.test.ts carries).
import "@/lib/db/schema";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => {
  const state: { execute: ReturnType<typeof vi.fn<(q: unknown) => unknown>>; failWith: Error | null } = {
    execute: vi.fn<(q: unknown) => unknown>(),
    failWith: null,
  };
  return state;
});
// A plain function in front of the spy: a spy whose implementation throws is
// reported by this Vitest as the test's own error even when the code under test
// is expected to reject, so the failure is injected here instead.
vi.mock("@/lib/db", () => ({
  db: {
    execute: (q: unknown) => {
      if (h.failWith) return Promise.reject(h.failWith);
      return h.execute(q);
    },
  },
}));

const { listInvitationsForAccount } = await import("./in-place");

const USER = "22222222-2222-4222-8222-222222222222";
const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.execute.mockReset();
  h.failWith = null;
});

describe("listInvitationsForAccount", () => {
  it("calls the listing definer with the user id and nothing else", async () => {
    h.execute.mockResolvedValue({ rows: [] });
    await listInvitationsForAccount(USER);
    const q = new PgDialect().sqlToQuery(h.execute.mock.calls[0]![0] as never);
    expect(q.sql).toMatch(/presby_list_invitations_for_account/);
    expect(q.params).toEqual([USER]);
  });

  it("returns the closed shape: id, congregation, purpose, expiry, and a display name for sign_in only", async () => {
    h.execute.mockResolvedValue({
      rows: [
        {
          invitation_id: ID,
          organization_name: "Quillhaven Fellowship",
          purpose: "sign_in",
          expires_at: "2026-10-27T12:00:00.000Z",
          person_display_name: "Wendeline Ashgrove",
        },
        {
          invitation_id: "99999999-9999-4999-8999-999999999999",
          organization_name: "Marlowe Fellowship",
          purpose: "treasurer",
          expires_at: new Date("2026-10-28T12:00:00.000Z"),
          person_display_name: null,
        },
      ],
    });
    const rows = await listInvitationsForAccount(USER);
    expect(rows).toEqual([
      {
        invitationId: ID,
        organizationName: "Quillhaven Fellowship",
        purpose: "sign_in",
        expiresAt: new Date("2026-10-27T12:00:00.000Z"),
        personDisplayName: "Wendeline Ashgrove",
      },
      {
        invitationId: "99999999-9999-4999-8999-999999999999",
        organizationName: "Marlowe Fellowship",
        purpose: "treasurer",
        expiresAt: new Date("2026-10-28T12:00:00.000Z"),
        personDisplayName: null,
      },
    ]);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["expiresAt", "invitationId", "organizationName", "personDisplayName", "purpose"]);
    }
  });

  it("a blank display name is null, and a column the function does not return is never invented", async () => {
    h.execute.mockResolvedValue({
      rows: [{ invitation_id: ID, organization_name: "Q", purpose: "sign_in", expires_at: "2026-10-27T12:00:00Z", person_display_name: "   ", token_hash: "leak", created_by_user_id: "leak" }],
    });
    const [row] = await listInvitationsForAccount(USER);
    expect(row!.personDisplayName).toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/leak/);
  });

  it("an unknown purpose is left out rather than shown as a card the page cannot describe", async () => {
    h.execute.mockResolvedValue({
      rows: [{ invitation_id: ID, organization_name: "Q", purpose: "mystery", expires_at: "2026-10-27T12:00:00Z", person_display_name: null }],
    });
    expect(await listInvitationsForAccount(USER)).toEqual([]);
  });

  it("a malformed user id returns an empty list without a round trip", async () => {
    expect(await listInvitationsForAccount("nope")).toEqual([]);
    expect(await listInvitationsForAccount("")).toEqual([]);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it("a database error THROWS (the page shows the N5 line; a silent empty list would read as 'nothing waiting')", async () => {
    h.failWith = new Error("connection reset");
    await expect(listInvitationsForAccount(USER)).rejects.toThrow("connection reset");
  });

  it("holds presby_app only: never the owner connection", () => {
    const source = readFileSync(path.resolve(__dirname, "in-place.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(source).toMatch(/import\s*\{\s*db\s*\}\s*from\s*"@\/lib\/db"/);
    expect(source).not.toMatch(/getPlatformDb/);
  });
});
