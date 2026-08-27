/**
 * header-controls.spec.ts — the signed-in header's two menus, in a browser.
 *
 * A BROWSER IS THE ONLY HONEST CHECK for most of this. The unit tests pin the
 * rendering decisions and the entitlement matrix against props; what they
 * cannot see is whether the server actually hands those props over, whether the
 * menu opens on a real pointer, whether the header survives 360px without
 * wrapping, and whether the popover is legible in light mode — which only
 * started working the day before this shipped and is therefore undertested by
 * construction.
 *
 * Fixtures: e2e/support/users.ts and e2e/support/seed-orgs.ts.
 *   admin@presby.invalid       — canAccessAdmin, NOT is_platform_admin, no orgs
 *   member@presby.invalid      — neither entitlement, no orgs
 *   org1@presby.invalid        — one congregation
 *   org1-org2@presby.invalid   — a congregation AND a presbytery
 */

import { test, expect, type Page } from "@playwright/test";
import { E2E_USERS, storageStatePath } from "./support/users";
import { E2E_ORGS } from "./support/seed-orgs";

const AVATAR = "avatar-menu-trigger";
const SWITCHER = "org-switcher-trigger";
const SWITCHER_STATIC = "org-switcher-static";

/** iPhone SE / small Android. The width the header has to survive. */
const NARROW = { width: 360, height: 740 };

async function openAvatar(page: Page) {
  await page.getByTestId(AVATAR).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

// ---------------------------------------------------------------------------
// The organization switcher — context
// ---------------------------------------------------------------------------

test.describe("org switcher — a user with two organizations", () => {
  test.use({ storageState: storageStatePath("org-multi") });

  test("names the organization you are in and switches to the other one", async ({
    page,
  }) => {
    await page.goto(`/o/${E2E_ORGS.alpha.slug}`);

    const trigger = page.getByTestId(SWITCHER);
    await expect(trigger).toContainText(E2E_ORGS.alpha.name);

    await trigger.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();

    // The organization you are already in is not somewhere to switch to.
    await expect(
      menu.getByRole("menuitem", { name: new RegExp(E2E_ORGS.alpha.name) }),
    ).toHaveCount(0);

    await menu
      .getByRole("menuitem", { name: new RegExp(E2E_ORGS.presbytery.name) })
      .click();

    await page.waitForURL((u) => u.pathname === `/o/${E2E_ORGS.presbytery.slug}`);
    await expect(page.getByTestId(SWITCHER)).toContainText(
      E2E_ORGS.presbytery.name,
    );
  });

  test("carries no membership language (DECISION-039)", async ({ page }) => {
    // A relationship is not a roll status. The elder on a presbytery committee
    // and the secretary who worships elsewhere both appear in this menu.
    await page.goto(`/o/${E2E_ORGS.alpha.slug}`);
    await page.getByTestId(SWITCHER).click();

    const text = await page.getByRole("menu").innerText();
    expect(text).toContain("Presbytery");
    expect(text).not.toMatch(/\bmember\b/i);
    expect(text).not.toMatch(/\broll\b/i);
  });

  test("offers the full chooser, and it still renders for a multi-org user", async ({
    page,
  }) => {
    // CONTRACT CHANGE (docs/work-log/2026-08-27-platform-home-and-portal.md,
    // DECISION-124): the chooser is /home now, not /orgs, and the switcher's
    // "Go to your home page" item links straight there.
    await page.goto("/home");
    await page.getByTestId(SWITCHER).click();
    await page.getByRole("menuitem", { name: "Go to your home page" }).click();

    await page.waitForURL((u) => u.pathname === "/home");
    await expect(
      page.getByRole("heading", { name: E2E_ORGS.alpha.name }),
    ).toBeVisible();
  });

  test("closes on Escape and returns focus to the trigger", async ({ page }) => {
    // Radix owns this. The assertion is that it has not been hand-rolled over.
    await page.goto(`/o/${E2E_ORGS.alpha.slug}`);
    const trigger = page.getByTestId(SWITCHER);

    await trigger.click();
    await expect(page.getByRole("menu")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("opens from the keyboard and moves between items with the arrows", async ({
    page,
  }) => {
    await page.goto(`/o/${E2E_ORGS.alpha.slug}`);

    await page.getByTestId(SWITCHER).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();

    // Radix puts focus on the first item as soon as the menu was opened from
    // the keyboard — no extra ArrowDown to get in.
    await expect(
      page.getByRole("menuitem", { name: new RegExp(E2E_ORGS.presbytery.name) }),
    ).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("menuitem", { name: "Go to your home page" }),
    ).toBeFocused();
  });

  test("stays on one row at 360px, and keeps the truncation safety valve wired", async ({
    page,
  }) => {
    // THE 360px REQUIREMENT. The failure mode this test guards against is a
    // header that WRAPS to a second line or OVERFLOWS the viewport
    // horizontally — either pushes the avatar off-screen or off-row.
    //
    // WHY THIS NO LONGER ASSERTS `scrollWidth > clientWidth` (it did, until
    // portal-chrome: docs/work-log/2026-08-25-portal-chrome.md, Phase 5 FIRST
    // PASS finding). Swapping the "presby" TEXT wordmark for the org's own
    // OrgMark (a small square logo/initials, no restated name) frees enough
    // width in the flex row that "Presbytery of the Eastern Fells" — the
    // longest name any e2e fixture organization carries — now fits on one
    // line WITHOUT clipping. Deliberate call, not a bug: a name that fits
    // should be shown in FULL. Truncation is a safety valve for names that
    // don't fit, not a mandate that every name be clipped regardless of
    // available width. So the real contract is: no wrap, no page overflow,
    // AND the safety valve (the `truncate` class on the name span) stays
    // wired for the day a longer name shows up — asserted below.
    //
    // Proving the valve actually CLIPS pixels needs a name longer than any
    // current e2e fixture provides at this width; rather than inventing an
    // unrealistically long fixture org name, that proof is a component-level
    // unit test instead — see global-nav.test.tsx, "keeps the truncate
    // mechanism wired for a name long enough to need it" — which isn't
    // constrained by fixture data.
    await page.setViewportSize(NARROW);
    await page.goto(`/o/${E2E_ORGS.presbytery.slug}`);

    const header = page.locator("header").first();
    const headerBox = await header.boundingBox();
    const avatarBox = await page.getByTestId(AVATAR).boundingBox();
    const triggerBox = await page.getByTestId(SWITCHER).boundingBox();
    expect(headerBox).not.toBeNull();
    expect(avatarBox).not.toBeNull();
    expect(triggerBox).not.toBeNull();

    // One row: the header is no taller than a single 44px control plus padding.
    expect(headerBox!.height).toBeLessThan(72);
    // Nothing has been pushed off the right edge.
    expect(avatarBox!.x + avatarBox!.width).toBeLessThanOrEqual(360);
    // No horizontal scroll anywhere on the page — the wrap/overflow failure
    // mode this test exists to catch, independent of whether any one name
    // happens to clip today.
    const documentWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(documentWidth).toBeLessThanOrEqual(360);

    // The org name is un-clipped at this width now — confirming the better
    // behavior actually shipped, not just that the old assertion is gone.
    const fullyVisible = await page
      .getByTestId(SWITCHER)
      .locator("span.truncate")
      .evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fullyVisible).toBe(true);

    // The safety valve stays wired even though it isn't visually clipping
    // this name today — see global-nav.test.tsx for the proof it engages.
    const nameSpanClass = await page
      .getByTestId(SWITCHER)
      .locator("span.truncate")
      .getAttribute("class");
    expect(nameSpanClass).toContain("truncate");
  });
});

test.describe("org switcher — a user with one organization", () => {
  test.use({ storageState: storageStatePath("org-single") });

  test("names the congregation with no menu, because there is nothing to switch to", async ({
    page,
  }) => {
    await page.goto(`/o/${E2E_ORGS.alpha.slug}`);

    await expect(page.getByTestId(SWITCHER_STATIC)).toContainText(
      E2E_ORGS.alpha.name,
    );
    await expect(page.getByTestId(SWITCHER)).toHaveCount(0);
  });

  test("still offers a way in from a page with no organization context", async ({
    page,
  }) => {
    // On /home there IS somewhere to go — into the congregation — so plain
    // text would be a dead control.
    await page.goto("/home");

    await page.getByTestId(SWITCHER).click();
    await expect(
      page.getByRole("menuitem", { name: new RegExp(E2E_ORGS.alpha.name) }),
    ).toBeVisible();
  });

  test("does not name an organization the user was just denied", async ({
    page,
  }) => {
    // The access-denied page renders inside the org shell, with the slug in the
    // URL. It is not in the user's list, so it is not "current" — the header
    // must not label it as where they are.
    await page.goto(`/o/${E2E_ORGS.beta.slug}`);

    await expect(page.getByTestId(SWITCHER)).toContainText("Organizations");
    const header = await page.locator("header").first().innerText();
    expect(header).not.toContain(E2E_ORGS.beta.name);
  });
});

test.describe("org switcher — a user with no organizations", () => {
  test.use({ storageState: storageStatePath("member") });

  test("gets no context control at all", async ({ page }) => {
    // Nothing to name. The avatar is still there, so the account is still
    // reachable and sign-out still works.
    await page.goto("/home");

    await expect(page.getByTestId(SWITCHER)).toHaveCount(0);
    await expect(page.getByTestId(SWITCHER_STATIC)).toHaveCount(0);
    await expect(page.getByTestId(AVATAR)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// The avatar menu — identity
// ---------------------------------------------------------------------------

test.describe("avatar menu — entitlements (DECISION-044)", () => {
  test.describe("a platform admin by session claim", () => {
    test.use({ storageState: storageStatePath("admin") });

    test("gets Platform admin but not Developer, and /admin actually admits them", async ({
      page,
    }) => {
      // This fixture holds ADMIN_ROLE and does NOT hold users.is_platform_admin
      // — nothing seeds that column. It is the row that breaks the moment the
      // two predicates are collapsed into one.
      await page.goto("/home");
      await openAvatar(page);

      await expect(
        page.getByRole("menuitem", { name: "Platform admin" }),
      ).toBeVisible();
      await expect(
        page.getByRole("menuitem", { name: "Developer" }),
      ).toHaveCount(0);

      // The item must not lead somewhere the Edge bounces: that reads as a
      // broken login rather than as a permissions boundary.
      await page.getByRole("menuitem", { name: "Platform admin" }).click();
      await page.waitForURL((u) => u.pathname.startsWith("/admin"));
      expect(new URL(page.url()).pathname).toBe("/admin");
    });
  });

  test.describe("a user with neither entitlement", () => {
    test.use({ storageState: storageStatePath("member") });

    test("sees only Account and Sign out", async ({ page }) => {
      await page.goto("/home");
      await openAvatar(page);

      const labels = await page.getByRole("menuitem").allInnerTexts();
      expect(labels).toEqual(["Account", "Sign out"]);
    });
  });

  test.describe("an ordinary congregation user", () => {
    test.use({ storageState: storageStatePath("org-single") });

    test("shows name and email, and no Organization admin item", async ({
      page,
    }) => {
      // "Organization admin" has no destination until P9. An item that goes
      // nowhere is worse than an absent one.
      await page.goto("/home");
      await openAvatar(page);

      const menu = page.getByRole("menu");
      await expect(menu).toContainText(E2E_USERS["org-single"].name);
      await expect(menu).toContainText(E2E_USERS["org-single"].email);
      expect(await menu.innerText()).not.toMatch(/organization admin/i);
    });

    test("reaches /account", async ({ page }) => {
      await page.goto("/home");
      await openAvatar(page);
      await page.getByRole("menuitem", { name: "Account" }).click();

      await page.waitForURL((u) => u.pathname === "/account");
    });

    test("signs out, exactly as it did before", async ({ page, context }) => {
      // The one behavior in the header that MUST NOT change. It is still a
      // <form> posting to signOut({ redirectTo: "/" }) — and it has to survive
      // Radix wanting to close the menu out from under the form.
      await page.goto("/home");
      await openAvatar(page);
      await page.getByRole("menuitem", { name: "Sign out" }).click();

      await page.waitForURL((u) => u.pathname === "/", { timeout: 15_000 });

      // Actually signed out, not merely redirected.
      await page.goto("/home");
      expect(new URL(page.url()).pathname).toBe("/signin");

      await context.clearCookies();
    });
  });
});

// ---------------------------------------------------------------------------
// Both colour schemes. Light mode started working the day before this shipped.
// ---------------------------------------------------------------------------

for (const scheme of ["light", "dark"] as const) {
  test.describe(`the open menus are legible in ${scheme} mode`, () => {
    test.use({
      storageState: storageStatePath("org-multi"),
      colorScheme: scheme,
    });

    test("popover surface is opaque and contrasts with its own text", async ({
      page,
    }) => {
      // An open dropdown over page content with a transparent background is
      // the classic token regression, and it is invisible to typecheck, build
      // and every unit test. The palette is inverted between the two schemes,
      // so asserting a fixed colour would only pin one of them.
      await page.goto(`/o/${E2E_ORGS.alpha.slug}`);
      await page.getByTestId(SWITCHER).click();

      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();

      const { background, color } = await menu.evaluate((el) => {
        const style = getComputedStyle(el);
        return { background: style.backgroundColor, color: style.color };
      });

      expect(background).not.toBe("rgba(0, 0, 0, 0)");
      expect(background).not.toBe("transparent");
      expect(background).not.toBe(color);

      const luminance = (rgb: string) => {
        const [r, g, b] = rgb.match(/\d+/g)!.map(Number);
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      };
      // Text and surface are on opposite sides of mid-grey in both schemes.
      expect(
        Math.abs(luminance(background) - luminance(color)),
      ).toBeGreaterThan(0.5);
    });

    test("the avatar circle is filled, not an invisible letter", async ({
      page,
    }) => {
      await page.goto("/home");

      const circle = page.getByTestId(AVATAR).locator("span").first();
      const background = await circle.evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      expect(background).not.toBe("rgba(0, 0, 0, 0)");
    });
  });
}

// ---------------------------------------------------------------------------
// 360px, both menus
// ---------------------------------------------------------------------------

test.describe("360px", () => {
  test.use({
    storageState: storageStatePath("org-multi"),
    viewport: NARROW,
  });

  test("both menus open inside the viewport", async ({ page }) => {
    await page.goto(`/o/${E2E_ORGS.alpha.slug}`);

    await page.getByTestId(SWITCHER).click();
    let box = await page.getByRole("menu").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(NARROW.width);

    await page.keyboard.press("Escape");

    await page.getByTestId(AVATAR).click();
    box = await page.getByRole("menu").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(NARROW.width);
  });

  test("both triggers meet the 44px touch target", async ({ page }) => {
    await page.goto(`/o/${E2E_ORGS.alpha.slug}`);

    for (const id of [SWITCHER, AVATAR]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.height, `${id} height`).toBeGreaterThanOrEqual(44);
      expect(box!.width, `${id} width`).toBeGreaterThanOrEqual(44);
    }
  });
});
