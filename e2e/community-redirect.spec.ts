/**
 * community-redirect.spec.ts - the route move (2026-10-22-founding-admin-
 * directory, Batch M, DECISION-201): `/o/<slug>/admin/members/...` is a
 * permanent redirect to `/o/<slug>/admin/community/...`, with the query string
 * intact, and a signed-in browser lands on the new page.
 *
 * The redirect is `next.config.ts`'s, so it answers before the proxy and needs
 * no session. The custom-host half (the old path is the neutral 404 there, not
 * a redirect) lives in custom-domains/lockdown.spec.ts.
 */

import { test, expect } from "@playwright/test";
import { storageStatePath } from "./support/users";
import { E2E_ORGS } from "./support/seed-orgs";

const SLUG = E2E_ORGS.alpha.slug;

test.describe("Community route move", () => {
  test("an unauthenticated request to the old path answers 308 to the new path, query intact", async ({ request }) => {
    const res = await request.get(`/o/${SLUG}/admin/members/new?x=1&y=two`, { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    const location = new URL(res.headers()["location"]!, "http://localhost");
    expect(location.pathname).toBe(`/o/${SLUG}/admin/community/new`);
    expect(location.search).toBe("?x=1&y=two");
  });

  test("the bare old path and a nested one redirect too", async ({ request }) => {
    const bare = await request.get(`/o/${SLUG}/admin/members`, { maxRedirects: 0 });
    expect(bare.status()).toBe(308);
    expect(new URL(bare.headers()["location"]!, "http://localhost").pathname).toBe(`/o/${SLUG}/admin/community`);

    const nested = await request.get(`/o/${SLUG}/admin/members/p-1/edit/guardians`, { maxRedirects: 0 });
    expect(nested.status()).toBe(308);
    expect(new URL(nested.headers()["location"]!, "http://localhost").pathname).toBe(
      `/o/${SLUG}/admin/community/p-1/edit/guardians`,
    );
  });

  test.describe("signed in", () => {
    test.use({ storageState: storageStatePath("congregation-clerk") });

    test("a bookmark to the old path lands on the new page", async ({ page }) => {
      await page.goto(`/o/${SLUG}/admin/members/new?x=1`);
      await expect(page).toHaveURL(new RegExp(`/o/${SLUG}/admin/community/new`));
      expect(new URL(page.url()).search).toBe("?x=1");
    });
  });
});
