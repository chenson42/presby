/**
 * assets.spec.ts - the public asset route serves only what a public page may
 * reference, on the platform host and on a church's own domain (F289,
 * DECISION-277; docs/work-log/2026-10-25-public-asset-allowlist.md, Phase 3
 * "Test Plan" E1). Runs in both lanes.
 *
 * The world is this spec's own (`buildWorld`), so it cannot disturb the other
 * custom-domain specs. ONE (a live custom host, canonical + alias) and WALK (a
 * PENDING domain, so its slug URL renders on the platform host instead of
 * handing off) each get a hero image referenced from their bundle and a brand
 * mark, both stored `public_site` (what ingest and the logo actions store).
 *
 * What it proves:
 *   - on the custom host (canonical and alias) and the platform host, the hero
 *     image and the mark are 200, immutable, with `x-content-type-options`
 *     EXACTLY `nosniff` (not a doubled `nosniff, nosniff`), and a case variant
 *     of the key is the same answer;
 *   - the miss matrix: a private PNG, a private PDF, the bundle JSON, another
 *     org's image, an unmapped uuid and a malformed key each get a response
 *     byte-identical (status, body, every header) to a random uuid's:
 *     404, {"error":"Not found"}, no-store;
 *   - sites.public_render off is that same 404, and restoring it brings the
 *     image back;
 *   - in a real browser the rendered pages' images actually LOAD (natural size
 *     > 0), on both hosts, and at 360px none of them pushes the page sideways.
 *     A 200 on the HTML proves nothing: three earlier bugs here were phone-only.
 */
import { test, expect, type APIResponse } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import {
  HOSTS,
  PNG_HERO,
  PNG_MARK,
  TITLES,
  bundleFor,
  buildWorld,
  getPublicRenderFlag,
  insertBlob,
  originFor,
  rawGet,
  restageBundleWithHero,
  setBrand,
  setMark,
  setPublicRenderFlag,
  snapshot,
  teardownWorld,
  type SiteOrg,
  type World,
} from "../support/custom-hosts";

let sql: Sql;
let world: World;
let originalFlag: boolean;

interface Keys {
  hero: string;
  mark: string;
  privatePng: string;
  privatePdf: string;
  bundle: string;
}
const keys: Record<"one" | "walk", Keys> = {} as never;

const NIL = "00000000-0000-4000-8000-000000000000";

async function seedSite(org: SiteOrg, bundle: { pages: unknown[] }, withPrivates: boolean): Promise<Keys> {
  const hero = await insertBlob(sql, org.orgId, { contentType: "image/png", bytes: PNG_HERO, audience: "public_site" });
  await restageBundleWithHero(sql, org, bundle, hero);
  await setBrand(sql, org.orgId, "#336699");
  const mark = await insertBlob(sql, org.orgId, { contentType: "image/png", bytes: PNG_MARK, audience: "public_site" });
  await setMark(sql, org.orgId, mark);
  const privatePng = withPrivates
    ? await insertBlob(sql, org.orgId, { contentType: "image/png", bytes: Buffer.concat([PNG_HERO, Buffer.from("ticket-shaped")]), audience: "private" })
    : "";
  const privatePdf = withPrivates
    ? await insertBlob(sql, org.orgId, { contentType: "application/pdf", bytes: Buffer.from("%PDF-1.7 e2e statement-shaped"), audience: "private" })
    : "";
  const [site] = (await sql`select content_bundle_key from organization_sites where organization_id = ${org.orgId}::uuid`) as { content_bundle_key: string }[];
  return { hero, mark, privatePng, privatePdf, bundle: site!.content_bundle_key };
}

test.beforeAll(async () => {
  sql = platformSql("custom-domains/assets.spec");
  originalFlag = await getPublicRenderFlag(sql);
  world = await buildWorld(sql);
  await setPublicRenderFlag(sql, true);
  keys.one = await seedSite(world.one, bundleFor(TITLES.one, TITLES.oneAbout), true);
  keys.walk = await seedSite(world.walk, bundleFor(TITLES.walk, "About Walk Church"), true);
});

test.afterAll(async () => {
  if (sql) {
    await setPublicRenderFlag(sql, originalFlag);
    expect(await getPublicRenderFlag(sql), "sites.public_render must be restored").toBe(originalFlag);
  }
  await teardownWorld(sql, world);
});

/** A place to ask: a Host and the path prefix the route lives under there. */
interface Door {
  label: string;
  host: string;
  path: (key: string) => string;
  keys: () => Keys;
}
const DOORS: Door[] = [
  { label: "custom host (canonical)", host: HOSTS.oneCanonical, path: (k) => `/assets/${k}`, keys: () => keys.one },
  { label: "custom host (alias)", host: HOSTS.oneAlias, path: (k) => `/assets/${k}`, keys: () => keys.one },
  { label: "platform host", host: "localhost", path: (k) => `/site/${world.walk.slug}/assets/${k}`, keys: () => keys.walk },
];

const ask = (request: Parameters<typeof rawGet>[0], baseURL: string | undefined, door: Door, key: string) =>
  rawGet(request, baseURL, door.host, door.path(key));

async function expectImage(res: APIResponse, label: string) {
  expect(res.status(), label).toBe(200);
  const h = res.headers();
  expect(h["content-type"], label).toBe("image/png");
  expect(h["cache-control"], label).toBe("public, max-age=31536000, immutable");
  // EXACTLY nosniff: if the global header in next.config.ts merged with the route's, this would read "nosniff, nosniff".
  expect(h["x-content-type-options"], label).toBe("nosniff");
  expect(h["location"], `${label}: an asset never redirects`).toBeUndefined();
}

test.describe("what a public page references is served", () => {
  for (const door of DOORS) {
    test(`${door.label}: the hero image and the mark are 200, immutable, nosniff; a case variant of the key is the same answer`, async ({ request, baseURL }) => {
      const k = door.keys();
      const hero = await ask(request, baseURL, door, k.hero);
      await expectImage(hero, "hero");
      expect(Buffer.compare(await hero.body(), PNG_HERO), "the exact stored bytes").toBe(0);

      const mark = await ask(request, baseURL, door, k.mark);
      await expectImage(mark, "mark");
      expect(Buffer.compare(await mark.body(), PNG_MARK)).toBe(0);

      const upper = await ask(request, baseURL, door, k.hero.toUpperCase());
      await expectImage(upper, "uppercase key");
      expect(Buffer.compare(await upper.body(), PNG_HERO)).toBe(0);
    });
  }
});

test.describe("everything else is the one neutral 404", () => {
  for (const door of DOORS) {
    test(`${door.label}: a private PNG, a private PDF, the bundle JSON, another org's image, an unmapped uuid and a malformed key are byte-identical to a random uuid`, async ({
      request,
      baseURL,
    }) => {
      const k = door.keys();
      const probes: Array<[string, string]> = [
        ["private PNG (ticket-attachment-shaped)", k.privatePng],
        ["private PDF (statement-shaped)", k.privatePdf],
        ["the bundle JSON", k.bundle],
        ["another org's image", world.twoImageId],
        ["the nil uuid", NIL],
        ["a malformed key", "not-a-uuid"],
        ["a path-shaped key", "..%2f..%2fetc%2fpasswd"],
      ];
      // First, plainly: none of these is served (the leak this pipeline closes).
      for (const [label, key] of probes) {
        const res = await ask(request, baseURL, door, key);
        expect(res.status(), `${label} must not be served`).toBe(404);
      }

      const baseline = await snapshot(await ask(request, baseURL, door, "5b2f0c9e-1d4a-4e6b-9c3a-7a8d2e1f0b4c"), door.host);
      expect(baseline.status).toBe(404);
      expect(baseline.body).toBe('{"error":"Not found"}');
      expect(baseline.headers["cache-control"]).toBe("no-store");
      expect(baseline.headers["x-content-type-options"]).toBe("nosniff");

      // Then, byte for byte: each is indistinguishable from a key that does not exist.
      for (const [label, key] of probes) {
        const got = await snapshot(await ask(request, baseURL, door, key), door.host);
        expect(got, label).toEqual(baseline);
      }
    });
  }

  test("an unmapped host and an unknown slug are the same bytes too", async ({ request, baseURL }) => {
    const door = DOORS[0]!;
    const baseline = await snapshot(await ask(request, baseURL, door, NIL), door.host);
    const unknownHost = await rawGet(request, baseURL, HOSTS.unknown, `/assets/${keys.one.hero}`);
    expect(await snapshot(unknownHost, HOSTS.unknown)).toEqual(baseline);
    const unknownSlug = await rawGet(request, baseURL, "localhost", `/site/no-such-site-${Date.now()}/assets/${keys.one.hero}`);
    expect((await snapshot(unknownSlug, "localhost")).body).toBe(baseline.body);
    expect(unknownSlug.status()).toBe(404);
  });

  test("sites.public_render off is that same 404; restoring it brings the image back", async ({ request, baseURL }) => {
    const door = DOORS[0]!;
    const baseline = await snapshot(await ask(request, baseURL, door, NIL), door.host);
    await setPublicRenderFlag(sql, false);
    try {
      expect(await snapshot(await ask(request, baseURL, door, keys.one.hero), door.host)).toEqual(baseline);
    } finally {
      await setPublicRenderFlag(sql, true);
    }
    await expectImage(await ask(request, baseURL, door, keys.one.hero), "hero after the flag is restored");
  });
});

// ---------------------------------------------------------------------------
// A real browser: the images actually load. A 200 on the HTML proves nothing.
// ---------------------------------------------------------------------------

interface LoadedImage {
  src: string;
  complete: boolean;
  naturalWidth: number;
  right: number;
  slot: string;
}

async function assetImages(page: import("@playwright/test").Page): Promise<{ images: LoadedImage[]; scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => {
    const images = [...document.querySelectorAll<HTMLImageElement>('img[src*="/assets/"]')].map((img) => ({
      src: img.getAttribute("src") ?? "",
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      right: Math.round(img.getBoundingClientRect().right),
      slot: img.closest("[data-slot]")?.getAttribute("data-slot") ?? img.getAttribute("data-slot") ?? "",
    }));
    return { images, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
  });
}

const PAGES: Array<{ label: string; url: (baseURL: string | undefined) => string; keys: () => Keys }> = [
  { label: "the custom host's home page", url: (b) => `${originFor(HOSTS.oneCanonical, b)}/`, keys: () => keys.one },
  { label: "the platform host's home page (WALK)", url: (b) => `${new URL(b ?? "http://localhost:3000").origin}/site/${world.walk.slug}`, keys: () => keys.walk },
];

test.describe("in a real browser the images load", () => {
  for (const pageDef of PAGES) {
    test(`${pageDef.label}: the hero and the logo have a natural size`, async ({ page, baseURL }) => {
      const res = await page.goto(pageDef.url(baseURL));
      expect(res!.status()).toBe(200);
      await page.waitForLoadState("load");

      // Poll: an <img> is `complete` a tick after `load` on a slow dev server.
      await expect
        .poll(async () => (await assetImages(page)).images.every((i) => i.complete && i.naturalWidth > 0), { timeout: 20_000 })
        .toBe(true);
      const { images } = await assetImages(page);
      const k = pageDef.keys();
      expect(images.some((i) => i.src.includes(k.hero)), "the hero image is on the page").toBe(true);
      expect(images.some((i) => i.src.includes(k.mark)), "the logo is on the page").toBe(true);
      for (const i of images) {
        expect(i.complete && i.naturalWidth > 0, `${i.src} loaded`).toBe(true);
      }
    });

    test(`${pageDef.label} at 360px: the images load and none overflows the page sideways`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      const res = await page.goto(pageDef.url(baseURL));
      expect(res!.status()).toBe(200);
      await page.waitForLoadState("load");
      await expect
        .poll(async () => (await assetImages(page)).images.every((i) => i.complete && i.naturalWidth > 0), { timeout: 20_000 })
        .toBe(true);

      const { images, scrollWidth, clientWidth } = await assetImages(page);
      const k = pageDef.keys();
      expect(images.some((i) => i.src.includes(k.hero))).toBe(true);
      expect(images.some((i) => i.src.includes(k.mark))).toBe(true);
      expect(clientWidth).toBeLessThanOrEqual(360);
      for (const i of images) {
        expect(i.right, `${i.src} (${i.slot}) ends within 360px`).toBeLessThanOrEqual(360);
      }
      expect(scrollWidth, "no sideways scroll").toBeLessThanOrEqual(360);
    });
  }
});
