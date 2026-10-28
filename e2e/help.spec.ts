/**
 * help.spec.ts - the public help site, signed out, in a browser (user-help Inc 1, DECISION-293).
 *
 * Needs NO flag and NO fixture user: /help and /docs are flagless, static and session-free, and
 * the proxy lets them through before edgeAuth() (R1). Every assertion is against an anonymous
 * visitor, which is the point: before Batch 3 the proxy sent this visitor to /signin.
 *
 * The page list comes from the registry (select.ts is pure), so adding a page adds its checks and
 * a pending or planned entry is exercised as soon as one exists. The jsdom tests pin the
 * rendering; this pins what only a browser sees: no redirect, real status codes (a 404 that
 * returns 200 is the Suspense-flush trap in CLAUDE.md), the <details> opening with JavaScript
 * held, and no horizontal overflow or small tap target at 360px.
 */
import { test, expect, type Page } from "@playwright/test";
import { pendingPages, plannedPages, publishedPages } from "../src/lib/help/select";

const NARROW = { width: 360, height: 740 };

/** Dev compiles each route on first touch. */
test.describe.configure({ timeout: 120_000 });

async function robots(page: Page): Promise<string> {
  return (await page.locator('meta[name="robots"]').first().getAttribute("content")) ?? "";
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("the help index and pages, signed out", () => {
  test("/help renders with no redirect: one h1, the skip link, noindex", async ({ page }) => {
    const res = await page.goto("/help");
    expect(res?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/help");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Help");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#help-main");
    expect(await robots(page)).toContain("noindex");
    // The chrome offers sign-in, not a session: it cannot tell who is reading.
    const header = page.locator("header");
    await expect(header.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "Open PresbyPortal", exact: true })).toBeVisible();
  });

  for (const entry of publishedPages()) {
    test(`/help/${entry.slug} responds 200 with exactly one h1`, async ({ page }) => {
      const res = await page.goto(`/help/${entry.slug}`);
      expect(res?.status()).toBe(200);
      expect(new URL(page.url()).pathname).toBe(`/help/${entry.slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(entry.title);
      expect(await robots(page)).toContain("noindex");
    });
  }

  test("an unknown slug, a pending slug and a planned slug under /help are all a 404 at their own URL, never a sign-in redirect, and indistinguishable from each other", async ({
    page,
  }) => {
    const paths = [
      "/help/no-such-page",
      ...pendingPages().map((p) => `/help/${p.slug}`),
      // A planned slug under /help/<x> is not a content page either.
      ...plannedPages().map((p) => `/help/${p.slug}`),
    ];
    let reference: string | null = null;
    for (const path of paths) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      // The anonymous visitor is not sent to /signin (the proxy admits the prefix).
      expect(new URL(page.url()).pathname, path).toBe(path);
      expect(await robots(page), path).toContain("noindex");
      const body = (await page.locator("body").innerText()).trim();
      reference ??= body;
      expect(body, `${path} differs from the first 404 body`).toBe(reference);
    }
  });

  test("/help/planned/<unknown> is a 404 at its own URL, never a sign-in redirect", async ({ page }) => {
    // Status and URL only: whether the body is the help 404 or the framework's depends on whether
    // generateStaticParams is empty (see the FINDING below), so this must not pin the body.
    const res = await page.goto("/help/planned/no-such");
    expect(res?.status()).toBe(404);
    expect(new URL(page.url()).pathname).toBe("/help/planned/no-such");
  });

  // FINDING (Batch 3, for the orchestrator): the design (R3, Phase 1 flow 1) says an unknown
  // slug renders `help/not-found.tsx` (the help chrome and "Go to the help index"). With
  // `dynamicParams = false` and a non-empty `generateStaticParams`, Next answers a slug outside
  // the list with the FRAMEWORK's default 404 (no help chrome, no link), in dev and in a
  // production build. `dynamicParams = true` renders the help 404 but makes Next cache one 404
  // per distinct URL (s-maxage one year), which `dynamicParams = false` exists to prevent.
  // (The planned tree shows the help 404 today only because its generateStaticParams is empty,
  // so it will behave like this one once the first planned page exists.)
  // Un-fixme this test when the architect rules.
  test.fixme("an unknown slug renders the help 404: the help chrome and a link to the index", async ({ page }) => {
    const res = await page.goto("/help/no-such-page");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("We couldn't find that page");
    await expect(page.getByRole("link", { name: "Go to the help index" })).toHaveAttribute("href", "/help");
  });

  test("/help/planned lists each planned item with its fixed label, and each planned page is noindex", async ({ page }) => {
    const res = await page.goto("/help/planned");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Planned and not available yet");
    const planned = plannedPages();
    if (planned.length === 0) {
      await expect(page.getByText("Nothing is listed here right now.")).toBeVisible();
    }
    for (const p of planned) {
      const res = await page.goto(`/help/planned/${p.slug}`);
      expect(res?.status(), p.slug).toBe(200);
      await expect(page.getByText("Planned. Not available yet. There is no date.").first(), p.slug).toBeVisible();
      expect(await robots(page), p.slug).toContain("noindex");
    }
  });

  test("a query string on /help is never reflected or followed (no open redirect)", async ({ page, baseURL }) => {
    for (const query of ["?next=//evil.example", "?callbackUrl=https://evil.example/x", "?redirect=%2F%2Fevil.example"]) {
      const res = await page.goto(`/help${query}`);
      expect(res?.status(), query).toBe(200);
      expect(new URL(page.url()).origin, query).toBe(new URL(baseURL!).origin);
      expect(new URL(page.url()).pathname, query).toBe("/help");
      await expect(page.getByRole("heading", { level: 1 }), query).toHaveText("Help");
      // What the reader can see or follow: not the framework's own router-state payload, which
      // legitimately carries the request URL.
      expect(await page.locator("body").innerText(), query).not.toContain("evil.example");
      const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
      expect(hrefs.filter((h) => h.includes("evil.example")), query).toEqual([]);
    }
  });

  test("/docs and /docs/x reach the app's 404 (not a sign-in redirect) until the docs tree exists", async ({ page }) => {
    // The proxy admits the prefix (DECISION-293); there is no /docs route yet, so what an
    // anonymous visitor must see is a 404, never /signin?callbackUrl=%2Fdocs.
    for (const path of ["/docs", "/docs/x"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      expect(new URL(page.url()).pathname, path).toBe(path);
    }
  });
});

test.describe("with JavaScript held", () => {
  test.use({ javaScriptEnabled: false });

  test("the on-this-page list is a native <details> that opens and lists its sections", async ({ page }) => {
    let checked = 0;
    for (const entry of publishedPages()) {
      await page.goto(`/help/${entry.slug}`);
      const details = page.locator("details", { has: page.locator("summary", { hasText: "On this page" }) });
      if ((await details.count()) === 0) continue;
      checked += 1;
      await details.locator("summary").click();
      await expect(details, entry.slug).toHaveAttribute("open", "");
      await expect(details.getByRole("link").first(), entry.slug).toBeVisible();
    }
    expect(checked, "at least one published page has three or more sections").toBeGreaterThan(0);
  });
});

test.describe("at 360px", () => {
  test.use({ viewport: NARROW });

  test("the index and every published page have no horizontal overflow, and the chrome's tap targets are 44px", async ({
    page,
  }) => {
    const paths = ["/help", "/help/planned", ...publishedPages().map((p) => `/help/${p.slug}`)];
    for (const path of paths) {
      await page.goto(path);
      expect(await overflow(page), `${path} overflows horizontally`).toBeLessThanOrEqual(0);
      const tooSmall = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll("header a, nav a")) {
          // The skip link is visually hidden until focused; it is not a tap target at rest.
          if ((el as HTMLElement).getAttribute("href") === "#help-main") continue;
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.height < 43.5) out.push(`${(el as HTMLElement).innerText.trim()} (${Math.round(r.height)}px)`);
        }
        return out;
      });
      expect(tooSmall, `${path}: tap targets under 44px`).toEqual([]);
    }
  });
});
