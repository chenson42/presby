/**
 * donors.ts and link-proposals.ts against a REAL Postgres connection
 * (docs/work-log/2026-10-15-online-giving.md, Batch 2): search and list, the
 * S4 reduced read, create/update, merge (flatten, link inheritance,
 * link_conflict), and the computed member-link proposal with every privacy
 * filter (G24) and the confirm/dismiss/remove life cycle. Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/giving/donors.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createDonorSchema, updateDonorContactSchema } from "./donor-input";
import type { GivingFixture } from "@/lib/testing/giving-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Actor = { personId: string; userId: string };

describe.skipIf(!hasDb)("donors.ts (Postgres-backed)", () => {
  let fx: GivingFixture;
  let donors: typeof import("./donors");
  let proposals: typeof import("./link-proposals");
  let withOrgContext: typeof import("@/lib/authz").withOrgContext;

  let org: string;
  let otherOrg: string;
  let treasurer: Actor;
  let viewer: Actor;
  let recorder: Actor;
  let manageOnly: Actor;
  let nobody: Actor;

  async function q(query: ReturnType<typeof sql>) {
    return fx.rowsOf(await fx.platform.execute(query));
  }

  /** The org's single plate-offering donor (one per org, by partial unique index): created once, then reused. */
  async function plateDonor(organizationId: string): Promise<string> {
    const [existing] = await q(sql`select id from giving_donors where organization_id = ${organizationId} and kind = 'unidentified'`);
    return existing ? String(existing.id) : fx.makeDonor(organizationId, "Unidentified (plate offering)", { kind: "unidentified" });
  }

  const create = (name: string, over: Record<string, unknown> = {}) =>
    createDonorSchema.parse({ displayName: name, ...over });

  async function makeMember(
    organizationId: string,
    first: string,
    last: string,
    email: string | null,
    options: { shared?: boolean; hidden?: boolean; hideEmail?: boolean; merged?: boolean } = {},
  ): Promise<{ personId: string; membershipId: string }> {
    const personId = await fx.makePerson(first, last);
    await fx.addMember(organizationId, personId);
    const membershipId = await fx.membershipOf(organizationId, personId);
    if (email) {
      await q(sql`insert into person_identifiers (person_id, kind, value_normalized, is_shared) values (${personId}, 'email', ${email}, ${options.shared ?? false})`);
    }
    if (options.hidden || options.hideEmail) {
      await q(sql`insert into person_privacy (person_id, organization_id, directory_hidden, hide_email) values (${personId}, ${organizationId}, ${options.hidden ?? false}, ${options.hideEmail ?? false})`);
    }
    return { personId, membershipId };
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/giving-fixture");
    fx = await mod.createGivingFixture("donors-db-test");
    donors = await import("./donors");
    proposals = await import("./link-proposals");
    ({ withOrgContext } = await import("@/lib/authz"));
    org = await fx.makeOrg("a", { givingToggle: true });
    otherOrg = await fx.makeOrg("b", { givingToggle: true });
    treasurer = await fx.makeActor(org, "Tess", "Treasurer", ["giving.view", "giving.record", "giving.manage"]);
    viewer = await fx.makeActor(org, "Vera", "Viewer", ["giving.view"]);
    recorder = await fx.makeActor(org, "Rex", "Recorder", ["giving.record"]);
    manageOnly = await fx.makeActor(org, "Max", "Manager", ["giving.manage"]);
    nobody = await fx.makeActor(org, "Nora", "Nobody", []);
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  // -----------------------------------------------------------------------
  describe("S4: what a giving.record-only holder can read", () => {
    let donorId: string;
    beforeAll(async () => {
      donorId = await fx.makeDonor(org, "Reduced Rosalind", { email: "rosalind@example.invalid" });
      await q(sql`update giving_donors set address_line1 = '1 Mill Road', city = 'Dover' where id = ${donorId}`);
    });

    it("may search (names only, a has-email boolean) and read the reduced donor - and nothing else", async () => {
      const found = await donors.searchDonors(recorder.personId, org, "rosalind");
      expect(found.kind).toBe("ok");
      if (found.kind !== "ok") return;
      expect(found.donors).toEqual([{ id: donorId, displayName: "Reduced Rosalind", kind: "identified", hasEmail: true }]);
      expect(JSON.stringify(found)).not.toMatch(/example\.invalid|Mill Road|Dover/);

      const reduced = await donors.getDonorReduced(recorder.personId, org, donorId);
      expect(reduced.kind).toBe("ok");
      if (reduced.kind !== "ok") return;
      expect(Object.keys(reduced.donor).sort()).toEqual(["displayName", "id", "kind", "link", "proposals"]);
      expect(JSON.stringify(reduced)).not.toMatch(/example\.invalid|Mill Road|Dover/);

      // the full read, the list, the duplicates panel are the ledger side: refused
      expect(await donors.getDonor(recorder.personId, org, donorId)).toEqual({ kind: "forbidden" });
      expect(await donors.listDonors(recorder.personId, org)).toEqual({ kind: "forbidden" });
      expect(await donors.listPossibleDuplicates(recorder.personId, org)).toEqual({ kind: "forbidden" });
    });

    it("a giving.manage-only holder, and a plain member, read no donor at all", async () => {
      for (const actor of [manageOnly, nobody]) {
        expect(await donors.searchDonors(actor.personId, org, "rosalind")).toEqual({ kind: "forbidden" });
        expect(await donors.getDonorReduced(actor.personId, org, donorId)).toEqual({ kind: "forbidden" });
        expect(await donors.getDonor(actor.personId, org, donorId)).toEqual({ kind: "forbidden" });
        expect(await donors.listDonors(actor.personId, org)).toEqual({ kind: "forbidden" });
        expect(await donors.listWaitingLinkSuggestions(actor.personId, org)).toEqual({ kind: "forbidden" });
      }
    });

    it("a viewer reads the full donor, including contact detail", async () => {
      const full = await donors.getDonor(viewer.personId, org, donorId);
      expect(full.kind).toBe("ok");
      if (full.kind !== "ok") return;
      expect(full.donor).toMatchObject({ email: "rosalind@example.invalid", addressLine1: "1 Mill Road", city: "Dover" });
    });
  });

  // -----------------------------------------------------------------------
  describe("searchDonors / listDonors", () => {
    let sOrg: string;
    let lister: Actor;
    beforeAll(async () => {
      sOrg = await fx.makeOrg("search", { givingToggle: true });
      lister = await fx.makeActor(sOrg, "Lia", "Lister", ["giving.view", "giving.record"]);
      for (let i = 0; i < 60; i++) {
        await fx.makeDonor(sOrg, `Searchable ${String(i).padStart(2, "0")}`, { email: i % 2 === 0 ? `s${i}@example.invalid` : null });
      }
      const survivor = await fx.makeDonor(sOrg, "Searchable Survivor");
      const merged = await fx.makeDonor(sOrg, "Searchable Merged Away");
      await q(sql`update giving_donors set merged_into_id = ${survivor}, merged_at = now() where id = ${merged}`);
      await fx.makeDonor(sOrg, "50%_Special");
    });

    it("returns at most 20, alphabetical, never a merged donor", async () => {
      const found = await donors.searchDonors(lister.personId, sOrg, "searchable");
      if (found.kind !== "ok") throw new Error("setup");
      expect(found.donors).toHaveLength(20);
      expect(found.donors.map((d) => d.displayName)).toEqual([...found.donors.map((d) => d.displayName)].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
      const all = await donors.searchDonors(lister.personId, sOrg, "Merged Away");
      expect(all).toEqual({ kind: "ok", donors: [] });
    });

    it("treats LIKE metacharacters as text and matches names only, not emails", async () => {
      const percent = await donors.searchDonors(lister.personId, sOrg, "50%_");
      expect(percent.kind === "ok" && percent.donors.map((d) => d.displayName)).toEqual(["50%_Special"]);
      const byEmail = await donors.searchDonors(lister.personId, sOrg, "s2@example");
      expect(byEmail).toEqual({ kind: "ok", donors: [] });
      const wildcard = await donors.searchDonors(lister.personId, sOrg, "%");
      expect(wildcard.kind === "ok" && wildcard.donors.map((d) => d.displayName)).toEqual(["50%_Special"]);
    });

    it("lists a-z in pages of 50 with no gap or repeat, and a viewer may search by email", async () => {
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await donors.listDonors(lister.personId, sOrg, { cursor });
        if (page.kind !== "ok") throw new Error("setup");
        seen.push(...page.donors.map((d) => d.id));
        cursor = page.nextCursor ?? undefined;
        pages += 1;
      } while (cursor && pages < 5);
      const expected = await q(sql`select id from giving_donors where organization_id = ${sOrg} and merged_into_id is null`);
      expect(seen).toHaveLength(expected.length);
      expect(new Set(seen).size).toBe(seen.length);

      const byEmail = await donors.listDonors(lister.personId, sOrg, { q: "s2@example" });
      expect(byEmail.kind === "ok" && byEmail.donors.map((d) => d.displayName)).toEqual(["Searchable 02"]);
      const tampered = await donors.listDonors(lister.personId, sOrg, { cursor: "!!!" });
      expect(tampered.kind).toBe("ok");
    });
  });

  // -----------------------------------------------------------------------
  describe("createDonor", () => {
    it("a recorder creates a donor with email normalised and created_by set", async () => {
      const result = await donors.createDonor(recorder.personId, org, recorder.userId, create("  Ottoline Vance ", { email: " Ottoline@Example.INVALID ", city: "Dover" }));
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      const [row] = await q(sql`select display_name, email, city, country, created_by from giving_donors where id = ${result.donorId}`);
      expect(row).toMatchObject({ display_name: "Ottoline Vance", email: "ottoline@example.invalid", city: "Dover", country: "US", created_by: recorder.userId });
    });

    it("warns, without blocking, on the same name or email; acknowledging creates it", async () => {
      const dup = await donors.createDonor(recorder.personId, org, recorder.userId, create("ottoline vance"));
      expect(dup).toMatchObject({ kind: "duplicate_warning", donors: [{ displayName: "Ottoline Vance" }] });
      const byEmail = await donors.createDonor(recorder.personId, org, recorder.userId, create("O. Vance", { email: "ottoline@example.invalid" }));
      expect(byEmail.kind).toBe("duplicate_warning");
      const forced = await donors.createDonor(recorder.personId, org, recorder.userId, create("ottoline vance"), { acknowledgeDuplicate: true });
      expect(forced.kind).toBe("ok");
    });

    it("refuses a viewer, a manage-only holder and a plain member", async () => {
      for (const actor of [viewer, manageOnly, nobody]) {
        expect(await donors.createDonor(actor.personId, org, actor.userId, create("Nope"))).toEqual({ kind: "forbidden" });
      }
    });
  });

  // -----------------------------------------------------------------------
  describe("updateDonorContact", () => {
    it("giving.manage edits contact detail and gets back only the names of what changed", async () => {
      const id = await fx.makeDonor(org, "Edit Edwina", { email: "edwina@example.invalid" });
      const unchanged = await donors.updateDonorContact(treasurer.personId, org, treasurer.userId,
        updateDonorContactSchema.parse({ donorId: id, displayName: "Edit Edwina", email: "edwina@example.invalid" }));
      expect(unchanged).toEqual({ kind: "ok", changedFields: [] });

      const changed = await donors.updateDonorContact(treasurer.personId, org, treasurer.userId,
        updateDonorContactSchema.parse({ donorId: id, displayName: "Edwina Edit", email: "e2@example.invalid", city: "Dover" }));
      expect(changed).toEqual({ kind: "ok", changedFields: ["displayName", "email", "city"] });
      const [row] = await q(sql`select display_name, email, city, updated_by from giving_donors where id = ${id}`);
      expect(row).toMatchObject({ display_name: "Edwina Edit", email: "e2@example.invalid", city: "Dover", updated_by: treasurer.userId });
    });

    it("is giving.manage only; refuses the plate donor, a merged donor and another organization's donor", async () => {
      const id = await fx.makeDonor(org, "Locked Larry");
      const input = updateDonorContactSchema.parse({ donorId: id, displayName: "Larry Locked" });
      for (const actor of [recorder, viewer, nobody]) {
        expect(await donors.updateDonorContact(actor.personId, org, actor.userId, input)).toEqual({ kind: "forbidden" });
      }
      const plate = await plateDonor(org);
      expect(await donors.updateDonorContact(treasurer.personId, org, treasurer.userId, updateDonorContactSchema.parse({ donorId: plate, displayName: "Plate 2" }))).toEqual({ kind: "not_editable" });

      const survivor = await fx.makeDonor(org, "Edit Survivor");
      await q(sql`update giving_donors set merged_into_id = ${survivor}, merged_at = now() where id = ${id}`);
      expect(await donors.updateDonorContact(treasurer.personId, org, treasurer.userId, input)).toEqual({ kind: "not_editable" });

      const foreign = await fx.makeDonor(otherOrg, "Foreign Fred");
      expect(await donors.updateDonorContact(treasurer.personId, org, treasurer.userId, updateDonorContactSchema.parse({ donorId: foreign, displayName: "X" }))).toEqual({ kind: "not_found" });
    });
  });

  // -----------------------------------------------------------------------
  describe("mergeDonors", () => {
    it("merges, keeps depth 1: donors already merged into the source are repointed to the target", async () => {
      const a = await fx.makeDonor(org, "Merge A");
      const b = await fx.makeDonor(org, "Merge B");
      const c = await fx.makeDonor(org, "Merge C (already in B)");
      await q(sql`update giving_donors set merged_into_id = ${b}, merged_at = now() where id = ${c}`);
      const result = await donors.mergeDonors(treasurer.personId, org, treasurer.userId, b, a);
      expect(result).toEqual({ kind: "ok", repointedCount: 1, inheritedLink: false });
      const rows = await q(sql`select id, merged_into_id from giving_donors where id in (${a}, ${b}, ${c})`);
      const by = Object.fromEntries(rows.map((r) => [String(r.id), r.merged_into_id]));
      expect(by[a]).toBeNull();
      expect(by[b]).toBe(a);
      expect(by[c]).toBe(a);
      // depth stays 1: nobody points at a donor that is itself merged
      expect(await q(sql`select 1 from giving_donors d join giving_donors t on t.id = d.merged_into_id where d.organization_id = ${org} and t.merged_into_id is not null and d.id in (${b}, ${c})`)).toHaveLength(0);
    });

    it("the target inherits the source's member link when it has none, and the source's own link is cleared", async () => {
      const member = await makeMember(org, "Linked", "Member", null);
      const source = await fx.makeDonor(org, "Linked Source", { linkedMembershipId: member.membershipId });
      const target = await fx.makeDonor(org, "Unlinked Target");
      const result = await donors.mergeDonors(treasurer.personId, org, treasurer.userId, source, target);
      expect(result).toEqual({ kind: "ok", repointedCount: 0, inheritedLink: true });
      const [t] = await q(sql`select linked_membership_id, link_source from giving_donors where id = ${target}`);
      expect(t).toMatchObject({ linked_membership_id: member.membershipId, link_source: "recorder_confirmed" });
      const [s] = await q(sql`select linked_membership_id, merged_into_id from giving_donors where id = ${source}`);
      expect(s).toMatchObject({ linked_membership_id: null, merged_into_id: target });
    });

    it("two donors linked to the SAME member merge cleanly; two DIFFERENT members is link_conflict (nothing changes)", async () => {
      const m1 = await makeMember(org, "Same", "Member", null);
      const m2 = await makeMember(org, "Other", "Member", null);
      const a = await fx.makeDonor(org, "Same A", { linkedMembershipId: m1.membershipId });
      const b = await fx.makeDonor(org, "Same B", { linkedMembershipId: m1.membershipId });
      expect((await donors.mergeDonors(treasurer.personId, org, treasurer.userId, a, b)).kind).toBe("ok");

      const c = await fx.makeDonor(org, "Conflict C", { linkedMembershipId: m1.membershipId });
      const d = await fx.makeDonor(org, "Conflict D", { linkedMembershipId: m2.membershipId });
      expect(await donors.mergeDonors(treasurer.personId, org, treasurer.userId, c, d)).toEqual({ kind: "link_conflict" });
      const rows = await q(sql`select id, merged_into_id, linked_membership_id from giving_donors where id in (${c}, ${d})`);
      expect(rows.every((r) => r.merged_into_id === null && r.linked_membership_id !== null)).toBe(true);
    });

    it("refuses itself, the plate donor, an already-merged donor, a foreign donor, and anyone without giving.manage", async () => {
      const a = await fx.makeDonor(org, "Guard A");
      const b = await fx.makeDonor(org, "Guard B");
      expect(await donors.mergeDonors(treasurer.personId, org, treasurer.userId, a, a)).toEqual({ kind: "same_donor" });
      const plate = await plateDonor(org);
      expect(await donors.mergeDonors(treasurer.personId, org, treasurer.userId, a, plate)).toEqual({ kind: "invalid_target" });
      expect(await donors.mergeDonors(treasurer.personId, org, treasurer.userId, plate, a)).toEqual({ kind: "invalid_target" });
      const foreign = await fx.makeDonor(otherOrg, "Foreign G");
      expect(await donors.mergeDonors(treasurer.personId, org, treasurer.userId, a, foreign)).toEqual({ kind: "not_found" });
      for (const actor of [recorder, viewer, nobody]) {
        expect(await donors.mergeDonors(actor.personId, org, actor.userId, a, b)).toEqual({ kind: "forbidden" });
      }
      expect((await donors.mergeDonors(treasurer.personId, org, treasurer.userId, a, b)).kind).toBe("ok");
      expect(await donors.mergeDonors(treasurer.personId, org, treasurer.userId, a, b)).toEqual({ kind: "invalid_target" }); // a is merged now
    });

    it("gifts stay where they were written and read through the root (no gift row is touched)", async () => {
      const fund = await fx.makeFund(org, `Merge Fund ${Date.now()}`);
      const source = await fx.makeDonor(org, "Gift Source");
      const target = await fx.makeDonor(org, "Gift Target");
      const gift = await fx.makeOfflineGift(org, source, fund, 1_234);
      await donors.mergeDonors(treasurer.personId, org, treasurer.userId, source, target);
      const [row] = await q(sql`select donor_id from giving_gifts where id = ${gift}`);
      expect(row!.donor_id).toBe(source);
      const gifts = await import("./gifts");
      const listed = await gifts.listGifts(treasurer.personId, org, { filters: { donorId: target } });
      expect(listed.kind === "ok" && listed.gifts.map((g) => g.id)).toContain(gift);
    });
  });

  // -----------------------------------------------------------------------
  describe("the member-link proposal (computed, never stored)", () => {
    let pOrg: string;
    let rec: Actor;
    let proposalFor: (donorId: string) => Promise<Array<{ membershipId: string; personName: string }>>;

    beforeAll(async () => {
      pOrg = await fx.makeOrg("proposals", { givingToggle: true });
      rec = await fx.makeActor(pOrg, "Pru", "Recorder", ["giving.record"]);
      proposalFor = (donorId) => withOrgContext(rec.personId, pOrg, (tx) => proposals.proposalsForDonor(tx, pOrg, donorId));
    });

    it("proposes a current member whose (non-shared) email matches exactly, by name", async () => {
      const member = await makeMember(pOrg, "Winifred", "Ashgrove", "winifred@example.invalid");
      const donor = await fx.makeDonor(pOrg, "W. Ashgrove", { email: "winifred@example.invalid" });
      expect(await proposalFor(donor)).toEqual([{ membershipId: member.membershipId, personName: "Winifred Ashgrove" }]);
    });

    it("never proposes from a SHARED email", async () => {
      await makeMember(pOrg, "Shared", "Spouse", "household@example.invalid", { shared: true });
      const donor = await fx.makeDonor(pOrg, "Household Giver", { email: "household@example.invalid" });
      expect(await proposalFor(donor)).toEqual([]);
    });

    it("never proposes a directory-hidden member, or one who hides their email", async () => {
      await makeMember(pOrg, "Hidden", "Harriet", "hidden@example.invalid", { hidden: true });
      await makeMember(pOrg, "Private", "Percy", "private@example.invalid", { hideEmail: true });
      const hidden = await fx.makeDonor(pOrg, "Hidden Giver", { email: "hidden@example.invalid" });
      const priv = await fx.makeDonor(pOrg, "Private Giver", { email: "private@example.invalid" });
      expect(await proposalFor(hidden)).toEqual([]);
      expect(await proposalFor(priv)).toEqual([]);
    });

    it("a member with a privacy row that hides nothing is still proposed (the default is not hidden)", async () => {
      await makeMember(pOrg, "Open", "Olive", "open@example.invalid");
      const personId = (await q(sql`select p.id from people p join person_identifiers pi on pi.person_id = p.id where pi.value_normalized = 'open@example.invalid'`))[0]!.id;
      await q(sql`insert into person_privacy (person_id, organization_id, directory_hidden, hide_email) values (${String(personId)}, ${pOrg}, false, false)`);
      const donor = await fx.makeDonor(pOrg, "Open Giver", { email: "open@example.invalid" });
      expect(await proposalFor(donor)).toHaveLength(1);
    });

    it("never proposes someone whose membership ended, a merged person, or a member of another organization", async () => {
      const ended = await makeMember(pOrg, "Gone", "Gerald", "gone@example.invalid");
      await q(sql`update memberships set ended_on = current_date - 1, ended_reason = 'test' where id = ${ended.membershipId}`);
      const endedDonor = await fx.makeDonor(pOrg, "Gone Giver", { email: "gone@example.invalid" });
      expect(await proposalFor(endedDonor)).toEqual([]);

      const survivor = await fx.makePerson("Surviving", "Sam");
      const merged = await makeMember(pOrg, "Merged", "Mona", "merged@example.invalid");
      await q(sql`update people set merged_into_id = ${survivor} where id = ${merged.personId}`);
      const mergedDonor = await fx.makeDonor(pOrg, "Merged Giver", { email: "merged@example.invalid" });
      expect(await proposalFor(mergedDonor)).toEqual([]);
      // un-merge so the fixture's person teardown (FK people.merged_into_id) can delete both
      await q(sql`update people set merged_into_id = null where id = ${merged.personId}`);

      await makeMember(otherOrg, "Elsewhere", "Edna", "elsewhere@example.invalid");
      const elsewhere = await fx.makeDonor(pOrg, "Elsewhere Giver", { email: "elsewhere@example.invalid" });
      expect(await proposalFor(elsewhere)).toEqual([]);
    });

    it("proposes only identified, unmerged, unlinked donors with an email", async () => {
      const member = await makeMember(pOrg, "Linked", "Lou", "lou@example.invalid");
      const already = await fx.makeDonor(pOrg, "Lou Already", { email: "lou@example.invalid", linkedMembershipId: member.membershipId });
      expect(await proposalFor(already)).toEqual([]);
      const noEmail = await fx.makeDonor(pOrg, "Lou No Email");
      expect(await proposalFor(noEmail)).toEqual([]);
    });

    it("confirm: only a CURRENT proposal can be confirmed (a bare membership id cannot), and it records who and how", async () => {
      const member = await makeMember(pOrg, "Constance", "Hale", "constance@example.invalid");
      const stranger = await makeMember(pOrg, "Stranger", "Stan", null);
      const donor = await fx.makeDonor(pOrg, "C. Hale", { email: "constance@example.invalid" });

      // a membership that is NOT proposed cannot be linked by supplying its id
      expect(await donors.confirmLink(rec.personId, pOrg, rec.userId, donor, stranger.membershipId)).toEqual({ kind: "no_proposal" });

      const ok = await donors.confirmLink(rec.personId, pOrg, rec.userId, donor, member.membershipId);
      expect(ok).toEqual({ kind: "ok", personName: "Constance Hale" });
      const [row] = await q(sql`select linked_membership_id, link_source, linked_by, linked_at is not null as stamped from giving_donors where id = ${donor}`);
      expect(row).toMatchObject({ linked_membership_id: member.membershipId, link_source: "recorder_confirmed", linked_by: rec.userId, stamped: true });

      expect(await donors.confirmLink(rec.personId, pOrg, rec.userId, donor, member.membershipId)).toEqual({ kind: "already_linked" });
    });

    it("dismiss: the pair is never proposed again; the decision is stored once", async () => {
      const member = await makeMember(pOrg, "Dismissed", "Dora", "dora@example.invalid");
      const donor = await fx.makeDonor(pOrg, "D. Dora", { email: "dora@example.invalid" });
      expect(await proposalFor(donor)).toHaveLength(1);
      expect(await donors.dismissLink(rec.personId, pOrg, rec.userId, donor, member.membershipId)).toEqual({ kind: "ok" });
      expect(await proposalFor(donor)).toEqual([]);
      expect(await donors.dismissLink(rec.personId, pOrg, rec.userId, donor, member.membershipId)).toEqual({ kind: "not_found" });
      expect(await q(sql`select 1 from giving_donor_link_decisions where donor_id = ${donor}`)).toHaveLength(1);
    });

    it("remove: unlinks, and the removed pair is not immediately re-proposed", async () => {
      const member = await makeMember(pOrg, "Removed", "Rene", "rene@example.invalid");
      const donor = await fx.makeDonor(pOrg, "R. Rene", { email: "rene@example.invalid" });
      await donors.confirmLink(rec.personId, pOrg, rec.userId, donor, member.membershipId);
      const result = await donors.removeLink(rec.personId, pOrg, rec.userId, donor);
      expect(result).toEqual({ kind: "ok", membershipId: member.membershipId, personName: "Removed Rene" });
      const [row] = await q(sql`select linked_membership_id, link_source, linked_at from giving_donors where id = ${donor}`);
      expect(row).toMatchObject({ linked_membership_id: null, link_source: null, linked_at: null });
      expect(await proposalFor(donor)).toEqual([]);
      expect(await donors.removeLink(rec.personId, pOrg, rec.userId, donor)).toEqual({ kind: "not_linked" });
    });

    it("link actions need giving.record; a viewer or manager cannot link", async () => {
      const member = await makeMember(pOrg, "Guarded", "Greta", "greta@example.invalid");
      const donor = await fx.makeDonor(pOrg, "G. Greta", { email: "greta@example.invalid" });
      const view = await fx.makeActor(pOrg, "Vi", "Viewer", ["giving.view"]);
      const mgr = await fx.makeActor(pOrg, "Mo", "Manager", ["giving.manage"]);
      for (const actor of [view, mgr]) {
        expect(await donors.confirmLink(actor.personId, pOrg, actor.userId, donor, member.membershipId)).toEqual({ kind: "forbidden" });
        expect(await donors.dismissLink(actor.personId, pOrg, actor.userId, donor, member.membershipId)).toEqual({ kind: "forbidden" });
        expect(await donors.removeLink(actor.personId, pOrg, actor.userId, donor)).toEqual({ kind: "forbidden" });
      }
    });

    it("countLinkProposals and the suggestions panel are the same query as the per-donor proposal", async () => {
      const cOrg = await fx.makeOrg("count", { givingToggle: true });
      const actor = await fx.makeActor(cOrg, "Cal", "Recorder", ["giving.record"]);
      await makeMember(cOrg, "Count", "One", "c1@example.invalid");
      await makeMember(cOrg, "Count", "Two", "c2@example.invalid");
      await makeMember(cOrg, "Count", "Hidden", "c3@example.invalid", { hidden: true });
      await fx.makeDonor(cOrg, "Donor One", { email: "c1@example.invalid" });
      await fx.makeDonor(cOrg, "Donor Two", { email: "c2@example.invalid" });
      await fx.makeDonor(cOrg, "Donor Hidden", { email: "c3@example.invalid" });
      const count = await withOrgContext(actor.personId, cOrg, (tx) => proposals.countLinkProposals(tx, cOrg));
      const panel = await donors.listWaitingLinkSuggestions(actor.personId, cOrg);
      expect(count).toBe(2);
      expect(panel.kind === "ok" && panel.suggestions.map((s) => s.donorName)).toEqual(["Donor One", "Donor Two"]);
    });
  });

  // -----------------------------------------------------------------------
  describe("possible duplicates", () => {
    it("pairs donors by exact email or case-insensitive name, once per pair, and reports them per donor", async () => {
      const dOrg = await fx.makeOrg("dupes", { givingToggle: true });
      const lister = await fx.makeActor(dOrg, "Dee", "Lister", ["giving.view"]);
      const a = await fx.makeDonor(dOrg, "Pair Alpha", { email: "pair@example.invalid" });
      const b = await fx.makeDonor(dOrg, "Different Name", { email: "pair@example.invalid" });
      const c = await fx.makeDonor(dOrg, "Twin Name");
      const d = await fx.makeDonor(dOrg, "TWIN name");
      await fx.makeDonor(dOrg, "Loner");
      const listed = await donors.listPossibleDuplicates(lister.personId, dOrg);
      if (listed.kind !== "ok") throw new Error("setup");
      expect(listed.pairs).toHaveLength(2);
      expect(listed.pairs.map((p) => p.reason).sort()).toEqual(["same_email", "same_name"]);

      const detail = await donors.getDonor(lister.personId, dOrg, a);
      expect(detail.kind === "ok" && detail.donor.possibleDuplicates).toEqual([{ id: b, displayName: "Different Name", reason: "same_email" }]);
      const twin = await donors.getDonor(lister.personId, dOrg, d);
      expect(twin.kind === "ok" && twin.donor.possibleDuplicates.map((x) => x.id)).toEqual([c]);
    });
  });

  describe("getDonor states", () => {
    it("a merged donor reports its survivor; another organization's donor is not_found", async () => {
      const survivor = await fx.makeDonor(org, "Survivor Sue");
      const merged = await fx.makeDonor(org, "Merged Max");
      await q(sql`update giving_donors set merged_into_id = ${survivor}, merged_at = now() where id = ${merged}`);
      expect(await donors.getDonor(viewer.personId, org, merged)).toEqual({ kind: "merged", survivorId: survivor });
      const foreign = await fx.makeDonor(otherOrg, "Foreign Fay");
      expect(await donors.getDonor(viewer.personId, org, foreign)).toEqual({ kind: "not_found" });
      expect(await donors.getDonorReduced(recorder.personId, org, foreign)).toEqual({ kind: "not_found" });
      expect(await donors.getDonorReduced(recorder.personId, org, merged)).toEqual({ kind: "not_found" });
    });
  });
});
