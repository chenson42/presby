/**
 * person-photos-roster.spec.ts - the public staff roster shows a website photo
 * (docs/work-log/2026-10-26-person-photos-inc1.md, Phase 3 Test Plan E2; Batch 3).
 * Runs in the `custom-hosts` project (Chromium resolves `*.invalid` to loopback).
 *
 * A staff roster on a congregation's public site, on the platform host (the
 * `/site/<slug>` path) and on a custom host: the website photo's image LOADS in a
 * real browser at 360 px (natural size above zero, no sideways scroll), is served
 * with the public door's headers, and after the photo is removed a fresh request
 * for it is the neutral 404 and the page shows no image.
 *
 * The world is this spec's own (`e2e-domains-photos-*` organizations): a person
 * with a public staff position and a website photo seeded straight into the
 * tables (a synthetic image; no real photograph). Photo rows go first on teardown
 * (F337). The first test of the `custom-hosts` project's first spec is the
 * resolver canary; this file adds none.
 */
import { test, expect, type Page } from "@playwright/test";
import { E2E_USERS } from "../support/users";
import { platformSql, withDbRetry, type Sql } from "../support/db";
import { captureFlags, setFlag, type FlagCapture } from "../support/flags";
import { removePhotoRows, removeSeededPhoto, seedPhoto, setPhotosToggle } from "../support/person-photos-fixture";
import { addDomain, createSiteOrg, originFor, rawGet, removeSiteOrg, setPublicRenderFlag, type SiteOrg } from "../support/custom-hosts";

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const ROSTER_FLAGS = ["sites.public_render", "sites.public_staff_directory"];
const ROSTER_HOST = "photos-roster.invalid";

function rosterBundle(title: string): { pages: unknown[] } {
  return {
    pages: [
      {
        path: "/",
        frontMatter: { title, navLabel: "Home" },
        mdxAst: {
          blocks: [
            { type: "hero", props: { heading: title } },
            { type: "liveSlot", props: { slot: "staffDirectory", filter: {} } },
          ],
        },
      },
    ],
  };
}

interface RosterSite {
  org: SiteOrg;
  personId: string;
  userId: string;
  photo: { photoId: string; imageKey: string; thumbKey: string };
}

test.describe("Person photos: the public staff roster", () => {
  test.setTimeout(180_000);

  let sql: Sql;
  let flags: FlagCapture;
  const stamp = Date.now();
  const sites: RosterSite[] = [];
  let platformSite: RosterSite;
  let customSite: RosterSite;

  async function userId(): Promise<string> {
    const rows = (await withDbRetry("acting user", () => sql`select id::text from users where email = ${E2E_USERS["mfa-enrolled"].email}`)) as { id: string }[];
    return rows[0]!.id;
  }

  async function makeRosterSite(label: string, idx: number, personName: string): Promise<RosterSite> {
    const org = await createSiteOrg(sql, {
      label,
      idx,
      name: `E2E Domains Photos ${label}`,
      bundle: rosterBundle(`Roster ${label} Home`),
      stamp,
    });
    await setPhotosToggle(sql, org.orgId, true);
    // A membership needs the organization's derived "Active Membership" group (a fixture org is created bare).
    await withDbRetry("roster derived group", () => sql`
      insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
      select ${org.orgId}::uuid, gt.id, 'Active Membership', 'derived', 'active_membership', true
        from group_types gt where gt.key = 'roster'`);
    const personId = `e2e93002-0000-4000-8000-${String((stamp % 100_000_000_000) * 10 + idx).padStart(12, "0")}`;
    await withDbRetry("roster person", async () => {
      await sql`insert into people (id, first_name, last_name, deletable_until)
                values (${personId}::uuid, ${personName}, 'Rosterman', now() + interval '3 hours')`;
      await sql`insert into memberships (person_id, organization_id, engagement_status)
                values (${personId}::uuid, ${org.orgId}::uuid, 'regular')`;
      await sql`insert into staff_positions (organization_id, person_id, position, position_key, starts_on, public_listed)
                values (${org.orgId}::uuid, ${personId}::uuid, 'Organist', 'organist', date '2020-01-01', true)`;
    });
    const uid = await userId();
    const photo = await seedPhoto(sql, { orgId: org.orgId, personId, userId: uid, tag: label, purposes: ["website"] });
    const site = { org, personId, userId: uid, photo };
    sites.push(site);
    return site;
  }

  test.beforeAll(async () => {
    sql = platformSql("person-photos.spec (public)");
    // A crashed prior run: photo rows first (F337), then the shared stale-org sweep may delete the orgs.
    const stale = (await withDbRetry("stale roster people", () => sql`
      select distinct pp.person_id::text as id from person_photos pp
        join organizations o on o.id = pp.organization_id where o.slug like 'e2e-domains-photos-%'`)) as { id: string }[];
    await removePhotoRows(sql, stale.map((s) => s.id));
    const staleOrgs = (await withDbRetry("stale roster orgs", () => sql`select id::text, slug from organizations where slug like 'e2e-domains-photos-%'`)) as {
      id: string;
      slug: string;
    }[];
    for (const o of staleOrgs) {
      try {
        await sql`alter table group_memberships disable trigger group_memberships_reject_derived`;
        await removeSiteOrg(sql, { orgId: o.id, slug: o.slug, name: o.slug, blobId: "" });
      } finally {
        await sql`alter table group_memberships enable trigger group_memberships_reject_derived`;
      }
    }

    flags = await captureFlags(sql, ROSTER_FLAGS);
    for (const key of ROSTER_FLAGS) await setFlag(sql, key, true);
    await setPublicRenderFlag(sql, true);

    platformSite = await makeRosterSite("photos-a", 4, "Platformhost");
    customSite = await makeRosterSite("photos-b", 5, "Customhost");
    await addDomain(sql, { orgId: customSite.org.orgId, hostname: ROSTER_HOST, role: "canonical", state: "live", token: 11 });
  });

  test.afterAll(async () => {
    if (sql) {
      await removePhotoRows(sql, sites.map((s) => s.personId));
      for (const s of sites) {
        await withDbRetry("remove roster site rows", async () => {
          await sql`delete from staff_positions where person_id = ${s.personId}::uuid`;
        });
        // drizzle/0033's group_memberships_reject_derived trigger refuses the cascade that deleting the
        // organization fires against its derived rows: disabled around the delete, re-enabled in a finally.
        try {
          await withDbRetry("remove roster site", async () => {
            await sql`alter table group_memberships disable trigger group_memberships_reject_derived`;
            try {
              await removeSiteOrg(sql, s.org);
            } finally {
              await sql`alter table group_memberships enable trigger group_memberships_reject_derived`;
            }
          });
        } finally {
          await withDbRetry("re-enable roster trigger", () => sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
        }
        await withDbRetry("remove roster person", async () => {
          await sql`delete from people where id = ${s.personId}::uuid`;
        });
      }
      await flags.restore();
    }
  });

  test.use({ viewport: { width: 360, height: 800 } });

  async function expectRosterPhoto(page: Page, url: string, name: string, srcPrefix: string, key: string) {
    await page.goto(url);
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 45_000 });
    const img = page.locator(`img[src*="${key}"]`).first();
    await expect(img).toBeVisible();
    expect(await img.getAttribute("src")).toContain(srcPrefix);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0);
    await noHorizontalOverflow(page);
  }

  test("platform host: the roster shows the website photo, it loads at natural size, and after removal the image is the neutral 404", async ({ page, request, baseURL }) => {
    const s = platformSite;
    await expectRosterPhoto(page, `/site/${s.org.slug}`, "Platformhost", `/site/${s.org.slug}/assets/`, s.photo.imageKey);
    const asset = `/site/${s.org.slug}/assets/${s.photo.imageKey}`;
    const served = await rawGet(request, baseURL, "localhost", asset);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("image/jpeg");
    expect(served.headers()["x-content-type-options"]).toBe("nosniff");

    await removeSeededPhoto(sql, s.photo.photoId, s.userId);
    const gone = await rawGet(request, baseURL, "localhost", asset);
    expect(gone.status()).toBe(404);
    expect(await gone.text()).toBe('{"error":"Not found"}');
    await page.goto(`/site/${s.org.slug}`);
    await expect(page.getByText("Platformhost").first()).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(`img[src*="${s.photo.imageKey}"]`)).toHaveCount(0);
  });

  test("a custom host: the roster shows the website photo, it loads at natural size, and after removal the image is the neutral 404", async ({ page, request, baseURL }) => {
    const s = customSite;
    const origin = originFor(ROSTER_HOST, baseURL);
    await expectRosterPhoto(page, `${origin}/`, "Customhost", "/assets/", s.photo.imageKey);
    const asset = `/assets/${s.photo.imageKey}`;
    const served = await rawGet(request, baseURL, ROSTER_HOST, asset);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("image/jpeg");

    await removeSeededPhoto(sql, s.photo.photoId, s.userId);
    const gone = await rawGet(request, baseURL, ROSTER_HOST, asset);
    expect(gone.status()).toBe(404);
    expect(await gone.text()).toBe('{"error":"Not found"}');
    await page.goto(`${origin}/`);
    await expect(page.getByText("Customhost").first()).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(`img[src*="${s.photo.imageKey}"]`)).toHaveCount(0);
  });
});
