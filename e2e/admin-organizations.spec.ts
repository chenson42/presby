/**
 * admin-organizations.spec.ts — S18's minimal `(admin)` operator brand
 * surface (P0.5 slice c, commit `c3`).
 *
 * Uses the "alpha" e2e fixture organization (Wrenfield Presbyterian Church,
 * e2e00000-0000-0000-0000-000000000002 — see e2e/support/seed-orgs.ts) rather
 * than a scripts/seed-dev.sql fixture, so this spec cannot collide with the
 * unrelated post-login-routing specs that also read that org: it only ever
 * touches `organization_brands`, a table those specs never read. The CRUD
 * smoke test sets a brand and then neutralises it in the same test, so the
 * fixture is back to "no brand" for whichever spec runs next — same
 * discipline as whats-new.spec.ts's create-then-verify pattern, but this
 * feature has a genuine "undo" action to call rather than leaving residue.
 */

import { test, expect } from "@playwright/test";
import { storageStatePath } from "./support/users";

const ALPHA_ORG_ID = "e2e00000-0000-0000-0000-000000000002";
const ALPHA_ORG_NAME = "Wrenfield Presbyterian Church";

// ---------------------------------------------------------------------------
// Test 1 — Member denied /admin/organizations (Edge proxy bounce)
// ---------------------------------------------------------------------------

test.describe("Member — /admin/organizations blocked by proxy", () => {
  test.use({ storageState: storageStatePath("member") });

  test("member navigating to /admin/organizations is redirected to /access-pending", async ({
    page,
  }) => {
    await page.goto("/admin/organizations");
    await expect(page).toHaveURL(/\/access-pending/, { timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Admin reaches the list, nav link present, OQ4 filter toggles
// ---------------------------------------------------------------------------

test.describe("Admin — /admin/organizations list", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("admin reaches the organizations list and sees the heading", async ({
    page,
  }) => {
    const response = await page.goto("/admin/organizations");
    expect(response?.status(), "/admin/organizations should respond 2xx").toBeLessThan(400);
    await expect(
      page.getByRole("heading", { name: "Organizations" }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Organizations nav link is present in the admin sidebar", async ({
    page,
  }) => {
    await page.goto("/admin/organizations");
    await expect(
      page.getByRole("link", { name: "Organizations" }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("OQ4 report: the 'Still on default palette' filter narrows the same list, not a second page", async ({
    page,
  }) => {
    await page.goto("/admin/organizations");
    await expect(page.getByText(ALPHA_ORG_NAME)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("link", { name: /still on default palette/i }).click();
    await expect(page).toHaveURL(/\/admin\/organizations\?filter=unbranded/);
    // Still on the SAME route (a filter, not a new page) and the never-branded
    // fixture is still present under the filter.
    await expect(page.getByText(ALPHA_ORG_NAME)).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Detail page: default-palette state, notFound on a bad id
// ---------------------------------------------------------------------------

test.describe("Admin — /admin/organizations/[id] detail", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("detail page shows the platform-default note for a never-branded org", async ({
    page,
  }) => {
    await page.goto(`/admin/organizations/${ALPHA_ORG_ID}`);
    await expect(
      page.getByRole("heading", { name: ALPHA_ORG_NAME }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/platform default palette/i),
    ).toBeVisible();
    // No neutralise button when there is nothing to neutralise (G10's "show
    // the default as it actually renders," not a disabled danger button).
    await expect(
      page.getByRole("button", { name: /neutralise brand/i }),
    ).toHaveCount(0);
  });

  test("a well-formed but nonexistent organization id 404s", async ({ page }) => {
    const response = await page.goto(
      "/admin/organizations/00000000-0000-0000-0000-000000000000",
    );
    expect(response?.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — CRUD smoke: set a brand, confirm it saved, neutralise it back
// ---------------------------------------------------------------------------

test.describe("Admin — set and neutralise a brand (leaves the fixture as found)", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("admin sets a brand colour, sees it save, then neutralises it back to default", async ({
    page,
  }) => {
    await page.goto(`/admin/organizations/${ALPHA_ORG_ID}`);

    const hexInput = page.locator("#seedHex");
    await hexInput.fill("#2f6f4f");

    // Flow 3 / D11: this seed produces no adjustments — the "Before you
    // save" box must stay absent for an ordinary colour.
    await expect(page.getByText(/before you save/i)).toHaveCount(0);

    await page.getByRole("button", { name: /save brand/i }).click();
    // getByRole("status"): the inline banner (E-c1/E-c2 — this must persist,
    // unlike the toast, which also fires and renders the same text).
    await expect(page.getByRole("status")).toHaveText("Brand saved.", {
      timeout: 15_000,
    });

    // The now-current-brand section reflects the save (server data
    // revalidated), and the organization drops out of the OQ4 filter.
    await expect(page.getByText(/platform default palette/i)).toHaveCount(0);

    await page.goto("/admin/organizations?filter=unbranded");
    await expect(page.getByText(ALPHA_ORG_NAME)).toHaveCount(0);

    // Neutralise it back — A2: the confirmation names the organization.
    await page.goto(`/admin/organizations/${ALPHA_ORG_ID}`);
    await page.getByRole("button", { name: /neutralise brand/i }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(ALPHA_ORG_NAME);

    await page
      .getByRole("button", { name: new RegExp(`yes, neutralise ${ALPHA_ORG_NAME}`, "i") })
      .click();

    // The confirm button closes the dialog immediately (Radix's own
    // behaviour), but the server action it kicked off is still in flight —
    // wait for its toast before navigating, or the next goto() can race
    // ahead of the actual DB write.
    await expect(
      page.getByText(`${ALPHA_ORG_NAME}'s brand has been neutralised.`),
    ).toBeVisible({ timeout: 15_000 });

    await page.goto(`/admin/organizations/${ALPHA_ORG_ID}`);
    await expect(page.getByText(/platform default palette/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});
