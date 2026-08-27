/**
 * Integration tests for src/lib/tickets.ts — run against a REAL Postgres
 * connection, not mocked. Follows `role-grants.test.ts`'s exact harness: the
 * `hasDb` skip-guard, dynamic imports inside `beforeAll` (this file's own
 * top-level import of `./tickets` would otherwise reach `@/lib/db`'s
 * module-scope pool construction before DATABASE_URL is confirmed set), and
 * a self-contained fixture created and torn down per file rather than
 * mutating `scripts/seed-dev.sql`'s fixture ids.
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is
 * SKIPPED there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run src/lib/tickets.test.ts
 *
 * `tickets.file` HAS ZERO PRODUCTION HOLDERS in this codebase — the sibling
 * `2026-08-20-role-catalog` pipeline owns binding a role to it. This fixture
 * therefore builds its OWN test role/grant carrying `tickets.file`, the same
 * way `role-grants.test.ts` builds its own fixture roles rather than relying
 * on any real seeded binding. That this works with zero production holders
 * is itself the thing Phase 3 asked to be confirmed, not assumed.
 *
 * TWO ORGANIZATIONS, deliberately:
 *   orgA — the general-purpose fixture: a `ticket_filer` role carrying
 *          `tickets.file`, a filer person, a plain member (active
 *          membership, no `tickets.file`), and a "lapsed submitter" whose
 *          `congregation_feedback` row is filed while an active member and
 *          whose membership ends afterward — the promotion fixture.
 *   orgB — exists only to prove getTicketThread()'s enumeration discipline:
 *          a ticket that genuinely exists, just not at orgA.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)("tickets.ts (Postgres-backed, real dev database)", () => {
  let fileTicket: typeof import("./tickets").fileTicket;
  let listTickets: typeof import("./tickets").listTickets;
  let getTicketThread: typeof import("./tickets").getTicketThread;
  let replyToTicket: typeof import("./tickets").replyToTicket;
  let submitFeedback: typeof import("./tickets").submitFeedback;
  let listPendingFeedback: typeof import("./tickets").listPendingFeedback;
  let getFeedbackPreview: typeof import("./tickets").getFeedbackPreview;
  let promoteFeedbackToTicket: typeof import("./tickets").promoteFeedbackToTicket;
  let dismissFeedback: typeof import("./tickets").dismissFeedback;

  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let organizations: typeof import("@/lib/db/domain/org").organizations;
  let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
  let groups: typeof import("@/lib/db/domain/groups").groups;
  let people: typeof import("@/lib/db/domain/people").people;
  let memberships: typeof import("@/lib/db/domain/people").memberships;
  let permissions: typeof import("@/lib/db/domain/authz").permissions;
  let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
  let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
  let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
  let users: typeof import("@/lib/db/schema").users;
  let tickets: typeof import("@/lib/db/domain/support").tickets;
  let ticketMessages: typeof import("@/lib/db/domain/support").ticketMessages;
  let ticketActions: typeof import("@/lib/db/domain/support").ticketActions;
  let congregationFeedback: typeof import("@/lib/db/domain/support").congregationFeedback;

  let orgA: string;
  let orgB: string;

  let filerRoleA: string; // carries tickets.file

  let filerPerson: string; // orgA — holds filerRoleA
  let plainMemberPerson: string; // orgA — active membership, no tickets.file
  let lapsedSubmitterPerson: string; // orgA — feedback filed while active, membership later ended
  let noMembershipPerson: string; // no membership ANYWHERE

  let outsideOrgBTicketId: string; // a real ticket, but at orgB, not orgA

  let grantingUserId: string; // a users.id row for the granted_by FK

  beforeAll(async () => {
    ({
      fileTicket,
      listTickets,
      getTicketThread,
      replyToTicket,
      submitFeedback,
      listPendingFeedback,
      getFeedbackPreview,
      promoteFeedbackToTicket,
      dismissFeedback,
    } = await import("./tickets"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ organizations } = await import("@/lib/db/domain/org"));
    ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
    ({ people, memberships } = await import("@/lib/db/domain/people"));
    ({ permissions, appRoles, appRolePermissions, roleGrants } = await import(
      "@/lib/db/domain/authz"
    ));
    ({ users } = await import("@/lib/db/schema"));
    ({ tickets, ticketMessages, ticketActions, congregationFeedback } = await import(
      "@/lib/db/domain/support"
    ));

    const platform = getPlatformDb();
    const stamp = Date.now();

    async function makeOrg(label: string) {
      const [row] = await platform
        .insert(organizations)
        .values({
          organizationType: "congregation",
          name: `Fixture Congregation ${label} for tickets.test.ts`,
          slug: `tickets-test-${label.toLowerCase()}-${stamp}`,
          path: `tickets_test_${label.toLowerCase()}_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      return row!.id;
    }

    orgA = await makeOrg("A");
    orgB = await makeOrg("B");

    // drizzle/0017's sync trigger fails loudly if the org has no
    // active_membership derived group yet — must exist before ANY
    // memberships insert at either org.
    const [gt] = await platform
      .insert(groupTypes)
      .values({ organizationId: null, key: "roster", name: "Roster" })
      .onConflictDoNothing()
      .returning({ id: groupTypes.id });
    let groupTypeId = gt?.id;
    if (!groupTypeId) {
      const [existing] = await platform
        .select({ id: groupTypes.id })
        .from(groupTypes)
        .where(eq(groupTypes.key, "roster"))
        .limit(1);
      groupTypeId = existing!.id;
    }

    async function activeMembershipGroup(organizationId: string) {
      await platform.insert(groups).values({
        organizationId,
        groupTypeId,
        name: "Active Membership",
        membershipSource: "derived",
        derivedFrom: "active_membership",
        isProtected: true,
      });
    }

    await activeMembershipGroup(orgA);
    await activeMembershipGroup(orgB);

    // Permission catalog row — already seeded by drizzle/0019 in a real dev
    // database, but onConflictDoNothing keeps this file self-sufficient
    // against a database that hasn't run it.
    await platform
      .insert(permissions)
      .values({
        key: "tickets.file",
        module: "support",
        description: "File and manage support tickets for this organization",
        sensitivityTier: 1,
      })
      .onConflictDoNothing();

    const [userRow] = await platform
      .insert(users)
      .values({
        email: `tickets-test-granter-${stamp}@example.invalid`,
        name: "Tickets Test Granter",
      })
      .returning({ id: users.id });
    grantingUserId = userRow!.id;

    // --- orgA: the general-purpose fixture ------------------------------

    // THE FIXTURE ROLE tickets.file HAS ZERO PRODUCTION HOLDERS ANYWHERE IN
    // THIS CODEBASE — built here from scratch, exactly like
    // role-grants.test.ts builds its own clerk/viewer fixture roles rather
    // than relying on a real seeded binding.
    const [filerRoleRow] = await platform
      .insert(appRoles)
      .values({
        organizationId: orgA,
        key: "ticket_filer_test",
        name: "Ticket Filer (test)",
        roleKind: "custom",
        isProtected: false,
      })
      .returning({ id: appRoles.id });
    filerRoleA = filerRoleRow!.id;
    await platform
      .insert(appRolePermissions)
      .values({ roleId: filerRoleA, permissionKey: "tickets.file" });

    async function person(first: string, last: string) {
      const [p] = await platform
        .insert(people)
        .values({ firstName: first, lastName: last })
        .returning({ id: people.id });
      return p!.id;
    }

    filerPerson = await person("Rosalind", "Achterberg");
    plainMemberPerson = await person("Tobias", "Vellacourt");
    lapsedSubmitterPerson = await person("Ines", "Okwuosa");

    async function membership(
      organizationId: string,
      personId: string,
      endedOn: string | null = null,
    ) {
      await platform.insert(memberships).values({
        organizationId,
        personId,
        engagementStatus: "regular",
        currentRoll: "active",
        endedOn,
      });
    }

    await membership(orgA, filerPerson);
    await membership(orgA, plainMemberPerson);
    await membership(orgA, lapsedSubmitterPerson);

    await platform.insert(roleGrants).values({
      organizationId: orgA,
      roleId: filerRoleA,
      personId: filerPerson,
      startsOn: "2020-01-01",
      grantedBy: grantingUserId,
    });

    noMembershipPerson = await person("Casimir", "Whitlark");
    // Deliberately no membership row anywhere for noMembershipPerson.

    // --- orgB: enumeration-discipline fixture ----------------------------

    const outsidePerson = await person("Marisol", "Enweazu");
    await membership(orgB, outsidePerson);
    const [outsideTicket] = await platform
      .insert(tickets)
      .values({
        organizationId: orgB,
        submitterPersonId: outsidePerson,
        subject: "A ticket that belongs to orgB, not orgA",
        changeClass: "bug",
        area: "other",
        priority: "normal",
      })
      .returning({ id: tickets.id });
    outsideOrgBTicketId = outsideTicket!.id;
  });

  afterAll(async () => {
    const platform = getPlatformDb();
    // ticket_messages_ticket_fk / ticket_actions_ticket_fk /
    // congregation_feedback_promoted_ticket_fk all reference
    // tickets(id, organization_id) with NO on-delete-cascade (deliberate —
    // drizzle/0019's own Data Model). Deleting `organizations` cascades to
    // `tickets` (tickets.organization_id DOES cascade) but that leaves these
    // three child tables blocking it — clear them first, in this order.
    for (const orgId of [orgA, orgB]) {
      await platform.delete(ticketMessages).where(eq(ticketMessages.organizationId, orgId));
      await platform.delete(ticketActions).where(eq(ticketActions.organizationId, orgId));
      await platform
        .delete(congregationFeedback)
        .where(eq(congregationFeedback.organizationId, orgId));
      await platform.delete(tickets).where(eq(tickets.organizationId, orgId));
    }
    // drizzle/0033's group_memberships_reject_derived trigger now (DECISION-
    // 110) also rejects the DELETE that cascading `organizations` fires
    // against this fixture's own active_membership-derived group_memberships
    // rows — disable it around the cascade, same as roll.test.ts's own
    // teardown does for roll_actions_freeze.
    await platform.execute(
      sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
    );
    try {
      await platform.delete(organizations).where(eq(organizations.id, orgA));
      await platform.delete(organizations).where(eq(organizations.id, orgB));
    } finally {
      await platform.execute(
        sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
      );
    }
    for (const id of [
      filerPerson,
      plainMemberPerson,
      lapsedSubmitterPerson,
      noMembershipPerson,
    ].filter(Boolean)) {
      await platform.delete(people).where(eq(people.id, id));
    }
    await platform.delete(users).where(eq(users.id, grantingUserId));
  });

  // ---------------------------------------------------------------------
  // hasTicketsFile gate
  // ---------------------------------------------------------------------

  describe("permission gate", () => {
    it("fileTicket: forbidden for a current member with no tickets.file", async () => {
      const result = await fileTicket(plainMemberPerson, orgA, {
        subject: "Should be blocked",
        changeClass: "bug",
        area: "other",
        priority: "normal",
        body: "This should not be created.",
      });
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("fileTicket: ok for the tickets.file holder", async () => {
      const result = await fileTicket(filerPerson, orgA, {
        subject: "The printer is broken",
        changeClass: "bug",
        area: "other",
        priority: "high",
        body: "It jams on every print job.",
      });
      expect(result.kind).toBe("ok");
    });

    it("fileTicket: a person with no relationship at orgA throws OrgAccessError, not a result", async () => {
      await expect(
        fileTicket(noMembershipPerson, orgA, {
          subject: "x",
          changeClass: "bug",
          area: "other",
          priority: "normal",
          body: "x",
        }),
      ).rejects.toMatchObject({ name: "OrgAccessError" });
    });
  });

  // ---------------------------------------------------------------------
  // listTickets / getTicketThread / replyToTicket — happy path + enumeration
  // ---------------------------------------------------------------------

  describe("listTickets, getTicketThread, replyToTicket", () => {
    let ticketId: string;

    it("fileTicket creates a ticket with a row-1 message, visible in listTickets", async () => {
      const filed = await fileTicket(filerPerson, orgA, {
        subject: "The directory search is slow",
        changeClass: "bug",
        area: "directory",
        priority: "normal",
        body: "Searching for a last name takes ten seconds.",
      });
      if (filed.kind !== "ok") throw new Error("expected ok");
      ticketId = filed.ticketId;

      const list = await listTickets(filerPerson, orgA);
      if (list.kind !== "ok") throw new Error("expected ok");
      const entry = list.tickets.find((t) => t.ticketId === ticketId);
      expect(entry).toBeDefined();
      expect(entry?.messageCount).toBe(1);
      expect(entry?.area).toBe("directory");
      expect(entry?.submitterDisplayName).toContain("Achterberg");
    });

    it("getTicketThread returns the thread with the filing message", async () => {
      const result = await getTicketThread(filerPerson, orgA, ticketId);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.thread.subject).toBe("The directory search is slow");
      expect(result.thread.messages).toHaveLength(1);
      expect(result.thread.messages[0]?.authorKind).toBe("submitter");
      expect(result.thread.messages[0]?.attachment).toBeNull();
    });

    it("replyToTicket adds a second message, reflected in the thread", async () => {
      const reply = await replyToTicket(filerPerson, orgA, ticketId, {
        body: "Following up — still slow as of today.",
      });
      expect(reply.kind).toBe("ok");

      const thread = await getTicketThread(filerPerson, orgA, ticketId);
      if (thread.kind !== "ok") throw new Error("expected ok");
      expect(thread.thread.messages).toHaveLength(2);
    });

    it("replyToTicket: not_found for a ticket id that doesn't exist", async () => {
      const result = await replyToTicket(filerPerson, orgA, randomUUID(), {
        body: "x",
      });
      expect(result).toEqual({ kind: "not_found" });
    });

    it("getTicketThread: enumeration discipline — a ticket belonging to another org collapses to not_found", async () => {
      const result = await getTicketThread(filerPerson, orgA, outsideOrgBTicketId);
      expect(result).toEqual({ kind: "not_found" });
    });

    it("getTicketThread: a genuinely nonexistent id ALSO collapses to not_found, indistinguishably", async () => {
      const result = await getTicketThread(filerPerson, orgA, randomUUID());
      expect(result).toEqual({ kind: "not_found" });
    });

    it("listTickets/getTicketThread: forbidden for a person with no tickets.file", async () => {
      expect(await listTickets(plainMemberPerson, orgA)).toEqual({ kind: "forbidden" });
      expect(await getTicketThread(plainMemberPerson, orgA, ticketId)).toEqual({
        kind: "forbidden",
      });
    });
  });

  // ---------------------------------------------------------------------
  // submitFeedback — no permission gate, but real membership required
  // ---------------------------------------------------------------------

  describe("submitFeedback", () => {
    it("has NO permission gate — a plain member with no tickets.file can submit", async () => {
      const result = await submitFeedback(
        plainMemberPerson,
        orgA,
        "The bulletin link on the website is broken.",
      );
      expect(result.kind).toBe("ok");
    });

    it("still requires a REAL current membership — withOrgContext throws for a stranger", async () => {
      await expect(
        submitFeedback(noMembershipPerson, orgA, "Should never land."),
      ).rejects.toMatchObject({ name: "OrgAccessError" });
    });

    it("rejects empty and oversized bodies", async () => {
      const empty = await submitFeedback(plainMemberPerson, orgA, "   ");
      expect(empty.kind).toBe("invalid_input");

      const tooLong = await submitFeedback(plainMemberPerson, orgA, "x".repeat(2001));
      expect(tooLong.kind).toBe("invalid_input");
    });
  });

  // ---------------------------------------------------------------------
  // promoteFeedbackToTicket — the Flow 0 promotion, and its lapsed-member case
  // ---------------------------------------------------------------------

  describe("promoteFeedbackToTicket", () => {
    let feedbackId: string;

    it("lapsedSubmitterPerson files feedback while an active member", async () => {
      const result = await submitFeedback(
        lapsedSubmitterPerson,
        orgA,
        "The giving page 404s when I click 'give now'.",
      );
      if (result.kind !== "ok") throw new Error("expected ok");
      feedbackId = result.feedbackId;

      const pending = await listPendingFeedback(filerPerson, orgA);
      if (pending.kind !== "ok") throw new Error("expected ok");
      expect(pending.feedback.some((f) => f.feedbackId === feedbackId)).toBe(true);
    });

    it("getFeedbackPreview returns the row for a tickets.file holder", async () => {
      const preview = await getFeedbackPreview(filerPerson, orgA, feedbackId);
      if (preview.kind !== "ok") throw new Error("expected ok");
      expect(preview.feedback.status).toBe("new");
      expect(preview.feedback.body).toContain("404s");
    });

    it("membership then ends for the original submitter, with no role_grants to block it", async () => {
      const platform = getPlatformDb();
      await platform
        .update(memberships)
        .set({ endedOn: "2021-06-15" })
        .where(eq(memberships.personId, lapsedSubmitterPerson));

      const [row] = await platform
        .select({ endedOn: memberships.endedOn })
        .from(memberships)
        .where(eq(memberships.personId, lapsedSubmitterPerson))
        .limit(1);
      expect(row?.endedOn).toBe("2021-06-15");
    });

    it("promoteFeedbackToTicket succeeds WITHOUT re-verifying the original submitter's now-ended membership", async () => {
      const result = await promoteFeedbackToTicket(filerPerson, orgA, feedbackId, {
        subject: "Giving page 404s on 'give now'",
        changeClass: "bug",
        area: "giving",
        priority: "high",
      });
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.submitterName).toContain("Okwuosa");

      // Produces a linked, readable ticket whose body is the original
      // feedback text, submitted by the ORIGINAL submitter — not the
      // promoting role-holder.
      const thread = await getTicketThread(filerPerson, orgA, result.ticketId);
      if (thread.kind !== "ok") throw new Error("expected ok");
      expect(thread.thread.submitterDisplayName).toContain("Okwuosa");
      expect(thread.thread.messages[0]?.body).toContain("404s");
      expect(thread.thread.messages[0]?.authorDisplayName).toContain("Okwuosa");

      // The feedback row itself is now 'promoted' and links to the ticket.
      const platform = getPlatformDb();
      const [feedbackRow] = await platform
        .select({
          status: congregationFeedback.status,
          promotedToTicketId: congregationFeedback.promotedToTicketId,
        })
        .from(congregationFeedback)
        .where(eq(congregationFeedback.id, feedbackId))
        .limit(1);
      expect(feedbackRow?.status).toBe("promoted");
      expect(feedbackRow?.promotedToTicketId).toBe(result.ticketId);
    });

    it("already_handled: promoting the same feedback row twice is rejected", async () => {
      const result = await promoteFeedbackToTicket(filerPerson, orgA, feedbackId, {
        subject: "Duplicate promotion attempt",
        changeClass: "bug",
        area: "giving",
        priority: "normal",
      });
      expect(result).toEqual({ kind: "already_handled" });
    });

    it("not_found: a feedback id that doesn't exist", async () => {
      const result = await promoteFeedbackToTicket(filerPerson, orgA, randomUUID(), {
        subject: "x",
        changeClass: "bug",
        area: "other",
        priority: "normal",
      });
      expect(result).toEqual({ kind: "not_found" });
    });

    it("forbidden: a plain member cannot promote feedback", async () => {
      const feedback = await submitFeedback(plainMemberPerson, orgA, "Another report.");
      if (feedback.kind !== "ok") throw new Error("expected ok");

      const result = await promoteFeedbackToTicket(plainMemberPerson, orgA, feedback.feedbackId, {
        subject: "x",
        changeClass: "bug",
        area: "other",
        priority: "normal",
      });
      expect(result).toEqual({ kind: "forbidden" });
    });
  });

  // ---------------------------------------------------------------------
  // dismissFeedback
  // ---------------------------------------------------------------------

  describe("dismissFeedback", () => {
    it("dismisses a new feedback row, then already_handled on a second attempt", async () => {
      const feedback = await submitFeedback(plainMemberPerson, orgA, "Not really actionable.");
      if (feedback.kind !== "ok") throw new Error("expected ok");

      const first = await dismissFeedback(filerPerson, orgA, feedback.feedbackId);
      expect(first).toEqual({ kind: "ok" });

      const second = await dismissFeedback(filerPerson, orgA, feedback.feedbackId);
      expect(second).toEqual({ kind: "already_handled" });

      const pending = await listPendingFeedback(filerPerson, orgA);
      if (pending.kind !== "ok") throw new Error("expected ok");
      expect(pending.feedback.some((f) => f.feedbackId === feedback.feedbackId)).toBe(false);
    });
  });
});
