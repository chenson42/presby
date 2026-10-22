import { test, expect } from "@playwright/test";
import { platformSql } from "./support/db";
import {
  createThrowawayUser,
  personAtOrgFor,
  removeInviteOrg,
  rosterUserId,
  seedInvitation,
  setupInviteOrg,
  sweepStaleInvitationFixtures,
  type InviteOrg,
} from "./support/invitation-fixture";

/**
 * The invitation fixture's safety net (docs/work-log/2026-10-21-invitations.md,
 * Phase 4 Batch 4). An acceptance addressed to the permanent `mfa-enrolled`
 * user gives that user a MEMBERSHIP at the throwaway congregation; if a run's
 * teardown is lost to a Neon connection drop, every later spec would sign that
 * user in and land on `/o/<slug>` or `/home` instead of `/admin` (the failure
 * the custom-domains UI fixture met in its QA run 1). globalSetup therefore
 * sweeps stale `e2e-invite-*` congregations before any session is acquired.
 * This spec proves the sweep really does repair that exact leftover, with no
 * server involved: it simulates the crashed run (an invitation accepted into a
 * throwaway org, teardown never called) and sweeps.
 */

test.setTimeout(90_000);

test("the sweep removes a crashed run's congregation, the throwaway accounts, and the membership it gave a permanent fixture user", async () => {
  const sql = platformSql("invitation-fixture-sweep.spec");
  let org: InviteOrg | undefined;
  try {
    org = await setupInviteOrg(sql);
    const selfId = await rosterUserId(sql, "mfa-enrolled");
    const email = (await sql`select email from users where id = ${selfId}::uuid`) as { email: string }[];
    const throwaway = await createThrowawayUser(sql, org, { tag: "leftover", name: "Leftover Account" });
    const invitation = await seedInvitation(sql, org, {
      purpose: "founding_administrator",
      email: email[0].email,
      createdByUserId: selfId,
    });
    // Accept as the account itself (the definer function runs the same on the owner connection).
    const accepted = (await sql`
      select outcome from presby_accept_invitation(${invitation.token}::text, ${selfId}::uuid, null, null, null)`) as { outcome: string }[];
    expect(accepted[0].outcome).toBe("accepted");
    expect(await personAtOrgFor(sql, org, selfId), "the leftover the sweep must repair").not.toBeNull();

    // The crashed run never tears down. The sweep (what globalSetup calls) must.
    const removed = await sweepStaleInvitationFixtures(sql);
    expect(removed).toBeGreaterThanOrEqual(1);

    const left = (await sql`
      select (select count(*)::int from organizations where slug = ${org.slug}) as orgs,
             (select count(*)::int from account_invitations where organization_id = ${org.orgId}::uuid) as invitations,
             (select count(*)::int from users where id = ${throwaway.id}::uuid) as throwaway_users,
             (select count(*)::int from memberships m join people p on p.id = m.person_id
               where p.user_id = ${selfId}::uuid) as memberships_of_mfa_enrolled,
             (select count(*)::int from people where user_id = ${selfId}::uuid) as people_of_mfa_enrolled`) as Record<string, number>[];
    expect(left[0]).toEqual({
      orgs: 0,
      invitations: 0,
      throwaway_users: 0,
      memberships_of_mfa_enrolled: 0,
      people_of_mfa_enrolled: 0,
    });
  } finally {
    // Idempotent: a no-op when the sweep already removed everything.
    await removeInviteOrg(sql, org);
  }
});
