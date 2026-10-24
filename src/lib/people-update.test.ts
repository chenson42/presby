/**
 * Integration tests for `updatePerson()`/`getPersonForEdit()` in
 * src/lib/people.ts — Increment 2 (docs/work-log/2026-08-26-member-
 * management-edit-person.md). Same harness as `people.test.ts`: real
 * Postgres, `hasDb` skip-guard, self-contained fixture. Run for real with:
 *   dotenv -e .env.local -- vitest run src/lib/people-update.test.ts
 *
 * `recordAudit()` is mocked at the module boundary, same posture and same
 * reason as `roll.test.ts`/`org-features.test.ts` — `@/lib/audit`
 * transitively imports `@/auth` (next-auth), which this test environment
 * cannot resolve.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";

vi.mock("server-only", () => ({}));
// audit.ts imports @/auth (next-auth), which this test environment cannot load.
// The REAL audit modules run: updatePerson() writes its audit rows with
// insertAuditRow() in the save's own transaction, so the tests read them back.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

// Lets one test force the in-transaction audit insert to throw, to prove the
// whole save rolls back with it (F199: no change without its record).
const auditControl = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return {
    ...actual,
    insertAuditRow: async (...args: Parameters<typeof actual.insertAuditRow>) => {
      if (auditControl.fail) throw new Error("audit insert failed (test-injected)");
      return actual.insertAuditRow(...args);
    },
  };
});

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "people.ts updatePerson/getPersonForEdit (Postgres-backed, real dev database)",
  () => {
    let updatePerson: typeof import("./people").updatePerson;
    let getPersonForEdit: typeof import("./people").getPersonForEdit;
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let organizations: typeof import("@/lib/db/domain/org").organizations;
    let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
    let groups: typeof import("@/lib/db/domain/groups").groups;
    let people: typeof import("@/lib/db/domain/people").people;
    let memberships: typeof import("@/lib/db/domain/people").memberships;
    let households: typeof import("@/lib/db/domain/people").households;
    let contactMethods: typeof import("@/lib/db/domain/people").contactMethods;
    let addresses: typeof import("@/lib/db/domain/people").addresses;
    let permissions: typeof import("@/lib/db/domain/authz").permissions;
    let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
    let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
    let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
    let users: typeof import("@/lib/db/schema").users;

    const stamp = Date.now();

    let orgA: string;
    let orgB: string;

    let editorPerson: string; // orgA — holds people.manage
    let grantlessPerson: string; // orgA — membership, no grants at all

    let actorUserId: string; // a real users row: audit_events.actor_user_id references it
    let ACTOR: { userId: string; email: string | null };
    let targetPerson: string; // orgA — the person being edited
    let householdA1: string;
    let householdA2: string; // a second orgA household, for the "existing" reassignment case
    let householdOrgB: string; // cross-org, for invalid_household

    const trackedPeopleIds: string[] = [];

    beforeAll(async () => {
      ({ updatePerson, getPersonForEdit } = await import("./people"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations } = await import("@/lib/db/domain/org"));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
      ({ people, memberships, households, contactMethods, addresses } =
        await import("@/lib/db/domain/people"));
      ({ permissions, appRoles, appRolePermissions, roleGrants } =
        await import("@/lib/db/domain/authz"));
      ({ users } = await import("@/lib/db/schema"));

      const platform = getPlatformDb();

      const [actorRow] = await platform
        .insert(users)
        .values({ email: `people-update-actor-${stamp}@example.invalid`, name: "Fixture Actor" })
        .returning({ id: users.id });
      actorUserId = actorRow!.id;
      ACTOR = { userId: actorUserId, email: `people-update-actor-${stamp}@example.invalid` };

      async function makeOrg(label: string) {
        const [row] = await platform
          .insert(organizations)
          .values({
            // Fixture teardown window — drizzle/0044's BEFORE DELETE guard.
            deletableUntil: fixtureDeletableUntil(),
            organizationType: "congregation",
            name: `Fixture Congregation ${label} for people-update.test.ts`,
            slug: `people-update-test-${label.toLowerCase()}-${stamp}`,
            path: `people_update_test_${label.toLowerCase()}_${stamp}`,
            platformStatus: "unmanaged",
          })
          .returning({ id: organizations.id });
        return row!.id;
      }
      orgA = await makeOrg("A");
      orgB = await makeOrg("B");

      const [gt] = await platform
        .insert(groupTypes)
        .values({ key: "roster", name: "Roster" })
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

      await platform
        .insert(permissions)
        .values({
          key: "people.manage",
          module: "people",
          description:
            "Create and edit people, households, and contact/address detail",
          sensitivityTier: 1,
        })
        .onConflictDoNothing();

      const [editorRole] = await platform
        .insert(appRoles)
        .values({
          organizationId: orgA,
          key: "member_editor",
          name: "Member Editor",
          roleKind: "custom",
        })
        .returning({ id: appRoles.id });
      await platform
        .insert(appRolePermissions)
        .values({ roleId: editorRole!.id, permissionKey: "people.manage" });

      async function person(first: string, last: string) {
        const [p] = await platform
          .insert(people)
          .values({
            firstName: first,
            lastName: last,
            deletableUntil: fixtureDeletableUntil(),
          })
          .returning({ id: people.id });
        trackedPeopleIds.push(p!.id);
        return p!.id;
      }

      editorPerson = await person("Cassandra", `Wrenfield${stamp}`);
      grantlessPerson = await person("Dorian", `Ashcombe${stamp}`);
      targetPerson = await person("Eulalia", `Marchbanks${stamp}`);

      const [hh1] = await platform
        .insert(households)
        .values({ organizationId: orgA, name: `Fixture Household A1 ${stamp}` })
        .returning({ id: households.id });
      householdA1 = hh1!.id;
      const [hh2] = await platform
        .insert(households)
        .values({ organizationId: orgA, name: `Fixture Household A2 ${stamp}` })
        .returning({ id: households.id });
      householdA2 = hh2!.id;
      const [hhB] = await platform
        .insert(households)
        .values({ organizationId: orgB, name: `Fixture Household B ${stamp}` })
        .returning({ id: households.id });
      householdOrgB = hhB!.id;

      await platform.insert(memberships).values([
        { organizationId: orgA, personId: editorPerson, engagementStatus: "regular" },
        { organizationId: orgA, personId: grantlessPerson, engagementStatus: "regular" },
        {
          organizationId: orgA,
          personId: targetPerson,
          engagementStatus: "regular",
          householdId: householdA1,
        },
      ]);

      await platform.insert(roleGrants).values({
        organizationId: orgA,
        roleId: editorRole!.id,
        personId: editorPerson,
        startsOn: "2020-01-01",
      });

      await platform.insert(contactMethods).values({
        personId: targetPerson,
        kind: "email",
        value: `eulalia-original-${stamp}@example.invalid`,
        isPrimary: true,
      });
      await platform.insert(addresses).values({
        personId: targetPerson,
        addressType: "home",
        line1: "1 Original Lane",
        city: "Original City",
        isPrimary: true,
      });
    });

    afterEach(() => {
      auditControl.fail = false;
    });

    afterAll(async () => {
      const platform = getPlatformDb();
      // drizzle/0033's group_memberships_reject_derived trigger now (DECISION-
      // 110) also rejects the DELETE that cascading `organizations` fires
      // against this fixture's own active_membership-derived group_memberships
      // rows — disable it around the cascade, same as roll.test.ts's own
      // teardown does for roll_actions_freeze.
      await platform.execute(
        sql`delete from audit_events where metadata->>'organizationId' in (${orgA}, ${orgB})`,
      );
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
      for (const id of trackedPeopleIds) {
        await platform.delete(people).where(eq(people.id, id));
      }
      await platform.delete(users).where(eq(users.id, actorUserId));
    });

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------
    type SqlRow = Record<string, unknown>;
    const rowsOf = async (query: ReturnType<typeof sql>): Promise<SqlRow[]> =>
      ((await getPlatformDb().execute(query)) as unknown as { rows: SqlRow[] }).rows;
    const emailsOf = (personId: string) =>
      rowsOf(sql`select id, value, subtype, is_primary, do_not_contact, verified_at, ended_at
                   from contact_methods where person_id = ${personId} and kind = 'email' order by created_at, id`);
    const phonesOf = (personId: string) =>
      rowsOf(sql`select id, value, is_primary, ended_at from contact_methods where person_id = ${personId} and kind = 'phone' order by created_at, id`);
    const auditOf = (personId: string) =>
      rowsOf(sql`select action, actor_user_id, actor_email, resource_type, metadata from audit_events
                  where resource_id = ${personId} order by action`);
    const identityOf = async (personId: string) =>
      (await rowsOf(sql`select first_name, last_name from people where id = ${personId}`))[0]!;
    let counter = 0;
    const addr = (tag: string) => `pu-${tag}-${stamp}-${(counter += 1)}@example.invalid`;

    /** A visible orgA person with the given owner-seeded addresses (oldest first). */
    async function freshPerson(
      label: string,
      emails: Array<{ value: string; main?: boolean; subtype?: string | null; verified?: boolean }> = [],
    ): Promise<{ id: string; last: string }> {
      const platform = getPlatformDb();
      const last = `${label}${stamp}${(counter += 1)}`;
      const [p] = await platform
        .insert(people)
        .values({ firstName: "Fresh", lastName: last, deletableUntil: fixtureDeletableUntil() })
        .returning({ id: people.id });
      trackedPeopleIds.push(p!.id);
      await platform.insert(memberships).values({ organizationId: orgA, personId: p!.id, engagementStatus: "regular" });
      // created_at follows the order given (oldest first); the MAIN row is inserted
      // first, because the deferred check wants a main whenever an address is active.
      const stamped = emails.map((e, i) => ({ ...e, seconds: i + 1 }));
      stamped.sort((a, b) => Number(b.main ?? false) - Number(a.main ?? false));
      for (const e of stamped) {
        const seconds = e.seconds;
        await platform.execute(sql`
          insert into contact_methods (person_id, kind, value, subtype, is_primary, created_at, verified_at)
          values (${p!.id}, 'email', ${e.value}, ${e.subtype ?? null}, ${e.main ?? false},
                  '2026-01-01T00:00:00Z'::timestamptz + make_interval(secs => ${seconds}),
                  ${e.verified ? "2026-01-01T00:00:00Z" : null}::timestamptz)`);
      }
      return { id: p!.id, last };
    }

    /** An updatePerson input that changes only the emails (from what the edit page would have loaded). */
    async function inputWith(
      person: { id: string; last: string },
      build: (loaded: Array<{ id: string; value: string; subtype: "personal" | "work" | "other" | null; isPrimary: boolean; doNotContact: boolean }>) => Array<{
        id?: string; value: string; subtype: "personal" | "work" | "other" | null; isPrimary: boolean; doNotContact: boolean;
      }>,
      extra: Partial<import("./people").UpdatePersonInput> = {},
    ): Promise<import("./people").UpdatePersonInput> {
      const read = await getPersonForEdit(editorPerson, orgA, person.id);
      if (read.kind !== "ok") throw new Error("fixture person not readable");
      const loaded = read.person.emails;
      return {
        personId: person.id,
        identity: { firstName: "Fresh", lastName: person.last },
        contact: { emails: { rows: build(loaded), knownIds: loaded.map((e) => e.id) } },
        household: { mode: "none" },
        ...extra,
      };
    }
    const keep = (e: { id: string; value: string; subtype: "personal" | "work" | "other" | null; isPrimary: boolean; doNotContact: boolean }) => ({
      id: e.id, value: e.value, subtype: e.subtype, isPrimary: e.isPrimary, doNotContact: e.doNotContact,
    });
    const blank = { subtype: null, isPrimary: false, doNotContact: false } as const;

    describe("getPersonForEdit", () => {
      it("forbidden without people.manage", async () => {
        const result = await getPersonForEdit(grantlessPerson, orgA, targetPerson);
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("not_found for a person with no membership in this org", async () => {
        const platform = getPlatformDb();
        const [stranger] = await platform
          .insert(people)
          .values({
            firstName: "Stray",
            lastName: `Elsewhere${stamp}`,
            deletableUntil: fixtureDeletableUntil(),
          })
          .returning({ id: people.id });
        trackedPeopleIds.push(stranger!.id);

        const result = await getPersonForEdit(editorPerson, orgA, stranger!.id);
        expect(result).toEqual({ kind: "not_found" });
      });

      it("returns the person's current identity, active emails, address, and household", async () => {
        const result = await getPersonForEdit(editorPerson, orgA, targetPerson);
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.person.firstName).toBe("Eulalia");
        expect(result.person.lastName).toBe(`Marchbanks${stamp}`);
        expect(result.person.emails.map((e) => e.value)).toEqual([`eulalia-original-${stamp}@example.invalid`]);
        expect(result.person.emails[0]).toMatchObject({ isPrimary: true, subtype: null, doNotContact: false });
        expect(result.person.address?.line1).toBe("1 Original Lane");
        expect(result.person.householdId).toBe(householdA1);
      });

      it("lists ACTIVE addresses only, main first, then oldest first; an ended address never appears", async () => {
        const main = addr("main");
        const older = addr("older");
        const newer = addr("newer");
        const gone = addr("gone");
        const p = await freshPerson("ReadOrder", [
          { value: older, subtype: "work" },
          { value: newer, subtype: "other" },
          { value: main, main: true, subtype: "personal" },
        ]);
        await getPlatformDb().execute(sql`
          insert into contact_methods (person_id, kind, value, ended_at)
          values (${p.id}, 'email', ${gone}, now())`);
        const read = await getPersonForEdit(editorPerson, orgA, p.id);
        if (read.kind !== "ok") throw new Error("not ok");
        expect(read.person.emails.map((e) => e.value)).toEqual([main, older, newer]);
        expect(read.person.emails.map((e) => e.isPrimary)).toEqual([true, false, false]);
        expect(read.person.emails[0]!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
      });

      it("reads the active primary phone only", async () => {
        const p = await freshPerson("PhoneRead");
        await getPlatformDb().execute(sql`
          insert into contact_methods (person_id, kind, value, is_primary, ended_at) values (${p.id}, 'phone', '555-0000', false, now())`);
        await getPlatformDb().execute(sql`
          insert into contact_methods (person_id, kind, value, is_primary) values (${p.id}, 'phone', '555-0199', true)`);
        const read = await getPersonForEdit(editorPerson, orgA, p.id);
        if (read.kind !== "ok") throw new Error("not ok");
        expect(read.person.phone).toBe("555-0199");
      });
    });

    describe("updatePerson", () => {
      it("forbidden without people.manage", async () => {
        const result = await updatePerson(
          grantlessPerson,
          orgA,
          { personId: targetPerson, identity: { firstName: "X", lastName: "Y" }, contact: {}, household: { mode: "none" } },
          ACTOR,
        );
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("not_found for a person with no membership in this org", async () => {
        const platform = getPlatformDb();
        const [stranger] = await platform
          .insert(people)
          .values({
            firstName: "Stray2",
            lastName: `Elsewhere2${stamp}`,
            deletableUntil: fixtureDeletableUntil(),
          })
          .returning({ id: people.id });
        trackedPeopleIds.push(stranger!.id);

        const result = await updatePerson(
          editorPerson,
          orgA,
          { personId: stranger!.id, identity: { firstName: "X", lastName: "Y" }, contact: {}, household: { mode: "none" } },
          ACTOR,
        );
        expect(result).toEqual({ kind: "not_found" });
      });

      it("invalid_household for a household belonging to another org", async () => {
        const result = await updatePerson(
          editorPerson,
          orgA,
          {
            personId: targetPerson,
            identity: { firstName: "Eulalia", lastName: `Marchbanks${stamp}` },
            contact: {},
            household: { mode: "existing", householdId: householdOrgB },
          },
          ACTOR,
        );
        expect(result).toEqual({ kind: "invalid_household" });
      });

      it("invalid_household writes NOTHING: no name, email, phone or address change, no audit row — regression for F216 (a refused save persisted part of the edit)", async () => {
        const original = addr("f216");
        const p = await freshPerson("F216", [{ value: original, main: true }]);
        const platform = getPlatformDb();
        await platform.execute(sql`insert into contact_methods (person_id, kind, value, is_primary) values (${p.id}, 'phone', '555-0116', true)`);
        const before = {
          identity: await identityOf(p.id),
          emails: await emailsOf(p.id),
          phones: await phonesOf(p.id),
          audit: await auditOf(p.id),
        };

        const input = await inputWith(
          p,
          (loaded) => [{ ...keep(loaded[0]!), value: addr("f216-new") }, { ...blank, value: addr("f216-extra") }],
          {
            identity: { firstName: "Renamed", lastName: p.last },
            household: { mode: "existing", householdId: householdOrgB },
            address: { line1: "9 Refused Row" },
          },
        );
        input.contact.phone = "555-0999";
        const result = await updatePerson(editorPerson, orgA, input, ACTOR);
        expect(result).toEqual({ kind: "invalid_household" });

        expect(await identityOf(p.id)).toEqual(before.identity);
        expect(await emailsOf(p.id)).toEqual(before.emails);
        expect(await phonesOf(p.id)).toEqual(before.phones);
        expect(await auditOf(p.id)).toEqual(before.audit);
        const read = await getPersonForEdit(editorPerson, orgA, p.id);
        if (read.kind !== "ok") throw new Error("not ok");
        expect(read.person.address).toBeNull();
      });

      it("an email refusal rolls the WHOLE save back: the name change does not stick, nothing is audited", async () => {
        const p = await freshPerson("Refused", [{ value: addr("keep"), main: true }]);
        const before = { identity: await identityOf(p.id), emails: await emailsOf(p.id), audit: await auditOf(p.id) };
        const input = await inputWith(p, (loaded) => [keep(loaded[0]!), { ...blank, value: "not-an-address" }], {
          identity: { firstName: "Renamed", lastName: p.last },
        });
        const result = await updatePerson(editorPerson, orgA, input, ACTOR);
        expect(result).toEqual({ kind: "email_refused", refusal: { reason: "invalid_shape", index: 1 } });
        expect(await identityOf(p.id)).toEqual(before.identity);
        expect(await emailsOf(p.id)).toEqual(before.emails);
        expect(await auditOf(p.id)).toEqual(before.audit);
      });

      it("a stale form (emails_changed) is refused whole, too", async () => {
        const p = await freshPerson("Stale", [{ value: addr("stale"), main: true }]);
        const input = await inputWith(p, (loaded) => loaded.map(keep), { identity: { firstName: "Renamed", lastName: p.last } });
        await getPlatformDb().execute(sql`
          insert into contact_methods (person_id, kind, value, created_at) values (${p.id}, 'email', ${addr("meanwhile")}, now() + interval '1 second')`);
        const before = { identity: await identityOf(p.id), emails: await emailsOf(p.id) };
        const result = await updatePerson(editorPerson, orgA, input, ACTOR);
        expect(result).toEqual({ kind: "email_refused", refusal: { reason: "emails_changed" } });
        expect(await identityOf(p.id)).toEqual(before.identity);
        expect(await emailsOf(p.id)).toEqual(before.emails);
      });

      it("a FAILED in-transaction person audit insert rolls the whole save back: no change without its record (F199)", async () => {
        // A NAME-ONLY change, so the person's own `tenant.person.updated` row is the only audit insert
        // (an email change would fail earlier, in the store's own audit rows).
        const p = await freshPerson("AuditFails", [{ value: addr("audit"), main: true }]);
        const before = { identity: await identityOf(p.id), emails: await emailsOf(p.id), audit: await auditOf(p.id) };
        auditControl.fail = true;
        await expect(
          updatePerson(
            editorPerson,
            orgA,
            { personId: p.id, identity: { firstName: "Renamed", lastName: p.last }, contact: {}, household: { mode: "none" } },
            ACTOR,
          ),
        ).rejects.toThrow(/audit insert failed/);
        auditControl.fail = false;
        expect(await identityOf(p.id)).toEqual(before.identity);
        expect(await emailsOf(p.id)).toEqual(before.emails);
        expect(await auditOf(p.id)).toEqual(before.audit);
      });

      it("a failed email audit insert rolls the whole save back too: the new address and the name change do not stick", async () => {
        const p = await freshPerson("EmailAuditFails", [{ value: addr("audit2"), main: true }]);
        const before = { identity: await identityOf(p.id), emails: await emailsOf(p.id) };
        const input = await inputWith(p, (loaded) => [keep(loaded[0]!), { ...blank, value: addr("audit2-new") }], {
          identity: { firstName: "Renamed", lastName: p.last },
        });
        auditControl.fail = true;
        await expect(updatePerson(editorPerson, orgA, input, ACTOR)).rejects.toThrow(/audit insert failed/);
        auditControl.fail = false;
        expect(await identityOf(p.id)).toEqual(before.identity);
        expect(await emailsOf(p.id)).toEqual(before.emails);
      });

      it("updates identity, emails, phone, address, and reassigns the household — and audits it in the same transaction", async () => {
        const read0 = await getPersonForEdit(editorPerson, orgA, targetPerson);
        if (read0.kind !== "ok") throw new Error("not ok");
        const loaded = read0.person.emails;
        const newAddress = `eulalia-updated-${stamp}@example.invalid`;
        const result = await updatePerson(
          editorPerson,
          orgA,
          {
            personId: targetPerson,
            identity: { firstName: "Eulalia", lastName: `Marchbanks${stamp}`, preferredName: "Lali" },
            contact: {
              emails: { rows: [{ ...keep(loaded[0]!), value: newAddress }], knownIds: loaded.map((e) => e.id) },
              phone: "555-0100",
            },
            address: { line1: "2 Updated Way", city: "Updated City" },
            household: { mode: "existing", householdId: householdA2 },
          },
          ACTOR,
        );
        expect(result).toEqual({ kind: "ok" });

        const read = await getPersonForEdit(editorPerson, orgA, targetPerson);
        expect(read.kind).toBe("ok");
        if (read.kind !== "ok") return;
        expect(read.person.preferredName).toBe("Lali");
        expect(read.person.emails.map((e) => e.value)).toEqual([newAddress]);
        expect(read.person.emails[0]!.isPrimary).toBe(true);
        expect(read.person.phone).toBe("555-0100");
        expect(read.person.address?.line1).toBe("2 Updated Way");
        expect(read.person.householdId).toBe(householdA2);

        // end-and-replace: the old row is ended, never edited in place; the new row is unverified
        const rows = await emailsOf(targetPerson);
        expect(rows).toHaveLength(2);
        expect(rows.find((r) => r.value === `eulalia-original-${stamp}@example.invalid`)!.ended_at).not.toBeNull();
        expect(rows.find((r) => r.value === newAddress)).toMatchObject({ ended_at: null, verified_at: null, is_primary: true });

        const audit = (await auditOf(targetPerson)).filter((a) => a.action === "tenant.person.updated");
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({
          actor_user_id: actorUserId,
          actor_email: ACTOR.email,
          resource_type: "person",
          metadata: { organizationId: orgA, emailChanged: true, phoneChanged: true },
        });
        expect(JSON.stringify(audit[0]!.metadata)).not.toContain("@");
      });

      it("emailChanged and phoneChanged are false when only the name changed", async () => {
        const p = await freshPerson("NameOnly", [{ value: addr("nameonly"), main: true }]);
        const result = await updatePerson(
          editorPerson,
          orgA,
          { personId: p.id, identity: { firstName: "Renamed", lastName: p.last }, contact: {}, household: { mode: "none" } },
          ACTOR,
        );
        expect(result).toEqual({ kind: "ok" });
        const [audit] = (await auditOf(p.id)).filter((a) => a.action === "tenant.person.updated");
        expect(audit!.metadata).toEqual({ organizationId: orgA, emailChanged: false, phoneChanged: false });
        expect((await auditOf(p.id)).filter((a) => String(a.action).startsWith("tenant.person_email."))).toEqual([]);
      });

      it("OMITTING emails leaves every address untouched; the phone still clears, by ending the row (nothing is deleted)", async () => {
        const original = addr("omit");
        const p = await freshPerson("Omit", [{ value: original, main: true }]);
        await getPlatformDb().execute(sql`insert into contact_methods (person_id, kind, value, is_primary) values (${p.id}, 'phone', '555-0150', true)`);
        const before = await emailsOf(p.id);
        const result = await updatePerson(
          editorPerson,
          orgA,
          { personId: p.id, identity: { firstName: "Fresh", lastName: p.last }, contact: {}, household: { mode: "none" } },
          ACTOR,
        );
        expect(result).toEqual({ kind: "ok" });
        expect(await emailsOf(p.id)).toEqual(before);
        const phones = await phonesOf(p.id);
        expect(phones).toHaveLength(1);
        expect(phones[0]!.ended_at).not.toBeNull();
        const read = await getPersonForEdit(editorPerson, orgA, p.id);
        if (read.kind !== "ok") throw new Error("not ok");
        expect(read.person.phone).toBeNull();
        expect(read.person.emails).toHaveLength(1);
      });

      it("an empty emails list ends every address: one ended row each, zero active, nothing deleted", async () => {
        const p = await freshPerson("Clear", [{ value: addr("c1"), main: true }, { value: addr("c2") }]);
        const result = await updatePerson(editorPerson, orgA, await inputWith(p, () => []), ACTOR);
        expect(result).toEqual({ kind: "ok" });
        const rows = await emailsOf(p.id);
        expect(rows).toHaveLength(2);
        expect(rows.every((r) => r.ended_at !== null)).toBe(true);
        const read = await getPersonForEdit(editorPerson, orgA, p.id);
        if (read.kind !== "ok") throw new Error("not ok");
        expect(read.person.emails).toEqual([]);
      });

      it("removing the main address returns a promotion note naming the new main (Q3)", async () => {
        const main = addr("pm");
        const oldest = addr("po");
        const p = await freshPerson("Promo", [{ value: oldest, subtype: "work" }, { value: addr("pn") }, { value: main, main: true }]);
        const result = await updatePerson(
          editorPerson,
          orgA,
          await inputWith(p, (loaded) => loaded.filter((e) => !e.isPrimary).map((e) => ({ ...keep(e), isPrimary: false }))),
          ACTOR,
        );
        expect(result).toEqual({ kind: "ok", notes: { promoted: { address: oldest } } });
        const active = (await emailsOf(p.id)).filter((r) => r.ended_at === null);
        expect(active.filter((r) => r.is_primary).map((r) => r.value)).toEqual([oldest]);
        const emailAudit = (await auditOf(p.id)).filter((a) => String(a.action).startsWith("tenant.person_email."));
        expect(emailAudit.map((a) => a.action).sort()).toEqual(["tenant.person_email.ended", "tenant.person_email.primary_changed"]);
        expect((await auditOf(p.id)).find((a) => a.action === "tenant.person_email.primary_changed")!.metadata).toMatchObject({ automatic: true });
      });

      it("saving an address another LIVE member of this congregation holds returns the shared-address note", async () => {
        const shared = addr("shared");
        const holder = await freshPerson("Holder", [{ value: shared, main: true }]);
        const p = await freshPerson("Sharer");
        const result = await updatePerson(editorPerson, orgA, await inputWith(p, () => [{ ...blank, value: shared.toUpperCase() }]), ACTOR);
        expect(result).toEqual({
          kind: "ok",
          notes: { shared: [{ address: shared, names: [`Fresh ${holder.last}`], more: 0 }] },
        });
        // the note is advice, never a refusal: the address was saved
        expect((await emailsOf(p.id)).map((r) => r.value)).toEqual([shared]);
      });

      it("a note is only for addresses ADDED by this save: re-saving an unchanged shared address says nothing", async () => {
        const shared = addr("shared2");
        await freshPerson("Holder2", [{ value: shared, main: true }]);
        const p = await freshPerson("Sharer2", [{ value: shared, main: true }]);
        const result = await updatePerson(editorPerson, orgA, await inputWith(p, (loaded) => loaded.map(keep)), ACTOR);
        expect(result).toEqual({ kind: "ok" });
      });

      it("household mode 'new' creates a household in this org and attaches it", async () => {
        const result = await updatePerson(
          editorPerson,
          orgA,
          {
            personId: targetPerson,
            identity: { firstName: "Eulalia", lastName: `Marchbanks${stamp}` },
            contact: {},
            household: { mode: "new", name: `Fixture Household A3 ${stamp}` },
          },
          ACTOR,
        );
        expect(result).toEqual({ kind: "ok" });

        const read = await getPersonForEdit(editorPerson, orgA, targetPerson);
        expect(read.kind).toBe("ok");
        if (read.kind !== "ok") return;
        expect(read.person.householdId).not.toBeNull();
        expect(read.person.householdId).not.toBe(householdA1);

        const platform = getPlatformDb();
        const [newHousehold] = await platform
          .select({ organizationId: households.organizationId })
          .from(households)
          .where(eq(households.id, read.person.householdId!))
          .limit(1);
        expect(newHousehold?.organizationId).toBe(orgA);
        // No manual cleanup needed: this household cascades away with orgA
        // in afterAll, same as householdA1/A2 — deleting it here first would
        // hit memberships_household_fk while targetPerson's membership still
        // points at it.
      });

      it("a person edited from orgB's own context is not_found (RLS-scoped, not app-level trust)", async () => {
        const platform = getPlatformDb();
        const [orgBEditor] = await platform
          .insert(people)
          .values({
            firstName: "OrgB",
            lastName: `Editor${stamp}`,
            deletableUntil: fixtureDeletableUntil(),
          })
          .returning({ id: people.id });
        trackedPeopleIds.push(orgBEditor!.id);
        const [orgBRole] = await platform
          .insert(appRoles)
          .values({
            organizationId: orgB,
            key: "member_editor_b",
            name: "Member Editor B",
            roleKind: "custom",
          })
          .returning({ id: appRoles.id });
        await platform
          .insert(appRolePermissions)
          .values({ roleId: orgBRole!.id, permissionKey: "people.manage" });
        await platform.insert(memberships).values({
          organizationId: orgB,
          personId: orgBEditor!.id,
          engagementStatus: "regular",
        });
        await platform.insert(roleGrants).values({
          organizationId: orgB,
          roleId: orgBRole!.id,
          personId: orgBEditor!.id,
          startsOn: "2020-01-01",
        });

        const result = await updatePerson(
          orgBEditor!.id,
          orgB,
          { personId: targetPerson, identity: { firstName: "Hijacked", lastName: "Name" }, contact: {}, household: { mode: "none" } },
          ACTOR,
        );
        expect(result).toEqual({ kind: "not_found" });

        // Confirm the cross-org attempt genuinely wrote nothing.
        const read = await getPersonForEdit(editorPerson, orgA, targetPerson);
        expect(read.kind).toBe("ok");
        if (read.kind !== "ok") return;
        expect(read.person.firstName).toBe("Eulalia");
      });
    });
  },
);
