/**
 * `notify.ts` against a REAL Postgres connection - who is told and how
 * (docs/work-log/2026-11-04-worship-inc1.md, Phase 3 "Email (R10)", DECISION-320,
 * DECISION-322; Phase 4 Batch 3). The full Send and the cancel have their own
 * files; this one pins the decision and the writers directly:
 *
 *   - `decideReach`: a presumed minor is `guardian` whatever addresses exist; the
 *     `person:role` address is Work first, then any other that is not marked do
 *     not contact; an address that is only do-not-contact is `do_not_contact`
 *     (not `no_address`); a person with nothing is `no_address`;
 *   - the writers queue one row per person, to the address the decision chose,
 *     with the exact link (origin + path, no query string), and write NOTHING when
 *     there is no safe origin;
 *   - the cancel notice skips minors, no-address and do-not-contact people and
 *     duplicates; the decline notice skips a minor placer.
 *
 * Nothing here sends: `sendQueued` would reach the mail provider.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/worship/notify.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { platformOrigin } from "@/lib/domains/host";
import type { WorshipTestWorld, WorshipWorld } from "@/lib/testing/worship-world";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 240_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("worship/notify.ts (Postgres-backed)", () => {
  let t: WorshipTestWorld;
  let notify: typeof import("./notify");
  let withOrgContext: typeof import("@/lib/authz").withOrgContext;
  let W: WorshipWorld;
  let slug: string;
  let stamp: string;
  const origin = platformOrigin() ?? "";

  const addr = (name: string) => `${name}-${stamp}@wnotify.example.invalid`;
  const inW = <T,>(fn: (tx: Parameters<Parameters<typeof withOrgContext>[2]>[0]) => Promise<T>) => withOrgContext(W.manager, W.org, fn);
  const mail = (name: string) =>
    t.q(sql`select template_key, subject, text_body, html_body, to_email from email_queue where to_email = ${addr(name)} order by created_at`);
  const person = async (first: string) => {
    const id = await t.person(W.org, first);
    await t.onRoster(W.org, W.band, id);
    return id;
  };
  const extraEmail = (personId: string, value: string, subtype: string, doNotContact = false) =>
    t.q(sql`insert into contact_methods (person_id, kind, subtype, value, is_primary, do_not_contact)
            values (${personId}, 'email', ${subtype}, ${value}, false, ${doNotContact})`);

  beforeAll(async () => {
    await import("@/lib/db/schema");
    const world = await import("@/lib/testing/worship-world");
    t = await world.createWorshipWorld("wnotify");
    notify = await import("./notify");
    ({ withOrgContext } = await import("@/lib/authz"));
    W = await t.build("a");
    slug = String((await t.one(sql`select slug from organizations where id = ${W.org}`)).slug);
    stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  });
  afterAll(async () => {
    if (t) {
      await t.q(sql`delete from email_queue where to_email like ${`%-${stamp}@wnotify.example.invalid`}`).catch(() => undefined);
      await t.fx.cleanup();
    }
  });

  // -------------------------------------------------------------------------
  describe("decideReach", () => {
    it("a Work address is used first, then a personal one; either is 'emailed'", async () => {
      const both = await person("Both");
      await t.email(both, addr("both-personal"), { subtype: "personal" });
      await extraEmail(both, addr("both-work"), "work");
      expect(await inW((tx) => notify.decideReach(tx, W.org, both))).toEqual({ outcome: "emailed", address: addr("both-work") });
      const personalOnly = await person("Personalonly");
      await t.email(personalOnly, addr("personal-only"), { subtype: "personal" });
      expect(await inW((tx) => notify.decideReach(tx, W.org, personalOnly))).toEqual({ outcome: "emailed", address: addr("personal-only") });
    });

    it("a presumed minor is 'guardian' whatever addresses exist, and with none at all", async () => {
      await t.email(W.child, addr("child"));
      expect(await inW((tx) => notify.decideReach(tx, W.org, W.child))).toEqual({ outcome: "guardian", address: null });
      const bareChild = await person("Barechild");
      await t.q(sql`update people set date_of_birth = current_date - interval '9 years' where id = ${bareChild}`);
      expect(await inW((tx) => notify.decideReach(tx, W.org, bareChild))).toEqual({ outcome: "guardian", address: null });
      // A household role of child counts as well, with no birth date (the one shared predicate).
      const householdChild = await person("Householdchild");
      await t.q(sql`update memberships set household_role = 'child' where organization_id = ${W.org} and person_id = ${householdChild}`);
      expect(await inW((tx) => notify.decideReach(tx, W.org, householdChild))).toEqual({ outcome: "guardian", address: null });
    });

    it("do not contact: only a marked address gives 'do_not_contact', not 'no_address'; a usable second address still reaches them", async () => {
      const dncOnly = await person("Dnconly");
      await t.email(dncOnly, addr("dnc-only"), { doNotContact: true });
      expect(await inW((tx) => notify.decideReach(tx, W.org, dncOnly))).toEqual({ outcome: "do_not_contact", address: null });
      const dncMain = await person("Dncmain");
      await t.email(dncMain, addr("dnc-main"), { doNotContact: true });
      await extraEmail(dncMain, addr("dnc-second"), "personal");
      expect(await inW((tx) => notify.decideReach(tx, W.org, dncMain))).toEqual({ outcome: "emailed", address: addr("dnc-second") });
    });

    it("no address at all is 'no_address'; a person with no standing at the organization is not offered an address", async () => {
      const none = await person("Noneaddr");
      expect(await inW((tx) => notify.decideReach(tx, W.org, none))).toEqual({ outcome: "no_address", address: null });
      const elsewhere = await t.fx.makePerson("Elsewhere", "Worshiptest");
      await t.email(elsewhere, addr("elsewhere"));
      expect(await inW((tx) => notify.decideReach(tx, W.org, elsewhere))).toEqual({ outcome: "no_address", address: null });
    });

    it("isPresumedMinor is exactly the shared predicate: exactly 18 is an adult, a day short of 18 is not", async () => {
      const edge18 = await person("Edgeeighteen");
      const edge17 = await person("Edgeseventeen");
      await t.q(sql`update people set date_of_birth = (current_date - interval '18 years')::date where id = ${edge18}`);
      await t.q(sql`update people set date_of_birth = (current_date - interval '18 years' + interval '1 day')::date where id = ${edge17}`);
      expect(await inW((tx) => notify.isPresumedMinor(tx, W.org, edge18))).toBe(false);
      expect(await inW((tx) => notify.isPresumedMinor(tx, W.org, edge17))).toBe(true);
      const direct = await t.one(sql`select presby_photo_subject_is_minor(${W.org}, ${edge17}) as m`);
      expect(direct.m).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("queueRequestNotices", () => {
    it("writes one row per person to the chosen address with the exact link and the line list; the one-request link goes to the request", async () => {
      const a = await person("Reqa");
      const b = await person("Reqb");
      const ids = await inW((tx) =>
        notify.queueRequestNotices(tx, {
          organizationId: W.org,
          notices: [
            { personId: a, address: addr("reqa"), assignmentIds: ["11111111-1111-4111-8111-111111111111"], lines: [{ startsAt: "2026-11-15T09:00", positionName: "Drums", teamName: "Band" }] },
            {
              personId: b,
              address: addr("reqb"),
              assignmentIds: ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"],
              lines: [
                { startsAt: "2026-11-15T09:00", positionName: "Vocals", teamName: "Band" },
                { startsAt: "2026-11-22T09:00", positionName: "Vocals", teamName: "Band" },
              ],
            },
          ],
        }),
      );
      expect(ids).toHaveLength(2);
      const [one] = await mail("reqa");
      const [many] = await mail("reqb");
      expect(one!.template_key).toBe("worship.notice.request");
      expect(one!.text_body).toContain(`${origin}/o/${slug}/worship/requests/11111111-1111-4111-8111-111111111111`);
      expect(many!.text_body).toContain(`${origin}/o/${slug}/worship`);
      expect(many!.text_body).not.toContain("/requests/");
      expect(many!.text_body).toContain("Sunday, November 22 at 9:00 AM: Vocals, Band");
    });

    it("writes NOTHING without a safe platform origin, and nothing for an empty list", async () => {
      const c = await person("Reqc");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "not a url");
      try {
        const none = await inW((tx) =>
          notify.queueRequestNotices(tx, {
            organizationId: W.org,
            notices: [{ personId: c, address: addr("reqc"), assignmentIds: ["44444444-4444-4444-8444-444444444444"], lines: [{ startsAt: "2026-11-15T09:00", positionName: "Drums", teamName: "Band" }] }],
          }),
        );
        expect(none).toEqual([]);
      } finally {
        vi.unstubAllEnvs();
      }
      expect(await mail("reqc")).toHaveLength(0);
      expect(await inW((tx) => notify.queueRequestNotices(tx, { organizationId: W.org, notices: [] }))).toEqual([]);
    });

    it("rolls back with its transaction: nothing is queued if the caller's transaction fails afterwards", async () => {
      const d = await person("Reqd");
      await expect(
        inW(async (tx) => {
          await notify.queueRequestNotices(tx, {
            organizationId: W.org,
            notices: [{ personId: d, address: addr("reqd"), assignmentIds: ["55555555-5555-4555-8555-555555555555"], lines: [{ startsAt: "2026-11-15T09:00", positionName: "Drums", teamName: "Band" }] }],
          });
          throw new Error("caller failed after queueing");
        }),
      ).rejects.toThrow("caller failed after queueing");
      expect(await mail("reqd")).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("queueCancelledNotices", () => {
    it("one notice per distinct person; a minor, a person with no address and a do-not-contact person get none", async () => {
      const ok = await person("Cancok");
      await t.email(ok, addr("canc-ok"));
      const dnc = await person("Cancdnc");
      await t.email(dnc, addr("canc-dnc"), { doNotContact: true });
      const none = await person("Cancnone");
      const ids = await inW((tx) =>
        notify.queueCancelledNotices(tx, { organizationId: W.org, startsAt: "2026-11-15T09:00", personIds: [ok, ok, dnc, none, W.child] }),
      );
      expect(ids).toHaveLength(1);
      expect(await mail("canc-ok")).toHaveLength(1);
      for (const name of ["canc-dnc", "child"]) expect(await mail(name), name).toHaveLength(0);
      const [m] = await mail("canc-ok");
      expect(m!.template_key).toBe("worship.notice.cancelled");
      expect(m!.text_body).toContain("The service on Sunday, November 15 at 9:00 AM was cancelled");
      expect(m!.text_body).toContain(`${origin}/o/${slug}/worship`);
    });

    it("writes nothing without a safe origin, or with nobody to tell", async () => {
      const ok = await person("Cancorigin");
      await t.email(ok, addr("canc-origin"));
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "not a url");
      try {
        expect(await inW((tx) => notify.queueCancelledNotices(tx, { organizationId: W.org, startsAt: "2026-11-15T09:00", personIds: [ok] }))).toEqual([]);
      } finally {
        vi.unstubAllEnvs();
      }
      expect(await mail("canc-origin")).toHaveLength(0);
      expect(await inW((tx) => notify.queueCancelledNotices(tx, { organizationId: W.org, startsAt: "2026-11-15T09:00", personIds: [] }))).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("queueDeclinedNotice", () => {
    const input = (toPersonId: string) => ({
      organizationId: W.org,
      toPersonId,
      groupId: W.band,
      eventId: W.sunday,
      positionName: "Drums",
      startsAt: "2026-11-15T09:00",
    });

    it("goes to the placer's address, links to the team's board for that service, and never names anyone", async () => {
      const placer = await person("Placer");
      await t.email(placer, addr("placer"));
      const ids = await inW((tx) => notify.queueDeclinedNotice(tx, input(placer)));
      expect(ids).toHaveLength(1);
      const [m] = await mail("placer");
      expect(m!.template_key).toBe("worship.notice.declined");
      expect(m!.text_body).toContain(`${origin}/o/${slug}/worship/teams/${W.band}/services/${W.sunday}`);
      expect(m!.text_body).toContain("Someone you scheduled has declined Drums on Sunday, November 15 at 9:00 AM.");
    });

    it("a placer with no address or who is a presumed minor gets nothing", async () => {
      const noAddr = await person("Placernoaddr");
      expect(await inW((tx) => notify.queueDeclinedNotice(tx, input(noAddr)))).toEqual([]);
      expect(await inW((tx) => notify.queueDeclinedNotice(tx, input(W.child)))).toEqual([]);
      expect(await mail("child")).toHaveLength(0);
    });
  });
});
