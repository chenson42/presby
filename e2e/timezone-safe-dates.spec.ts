import { test, expect, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

async function signInAdmin(page: Page) {
  await page.goto("/signin");
  await page.locator('input[name="email"]').fill(ADMIN_EMAIL!);
  await page.locator('input[name="password"]').fill(ADMIN_PASSWORD!);
  await page.getByRole("button", { name: /sign in with email/i }).click();
  await page.waitForURL((u) => u.pathname !== "/signin", { timeout: 10_000 });
}

async function waitForFormattedDateHydration(page: Page) {
  // Server renders <time>{YYYY-MM-DD}</time>; useEffect swaps in toLocaleString.
  // We wait for at least one <time> element whose visible text is no longer the
  // bare date slice of its own datetime attribute.
  await page.waitForFunction(
    () => {
      const els = Array.from(document.querySelectorAll("time[datetime]"));
      if (els.length === 0) return false;
      return els.some((el) => {
        const dt = el.getAttribute("datetime") ?? "";
        const text = (el.textContent ?? "").trim();
        return text.length > 0 && text !== dt.slice(0, 10);
      });
    },
    { timeout: 5_000 },
  );
}

test.describe("Timezone-safe dates", () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD,
    "SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD must be set in .env.local",
  );

  test("FormattedDate renders <time dateTime> + hydrates without hydration warnings", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await signInAdmin(page);
    await page.goto("/admin/users");
    await waitForFormattedDateHydration(page);

    const els = page.locator("time[datetime]");
    const count = await els.count();
    expect(count, "expected at least one <time> rendered by FormattedDate").toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const el = els.nth(i);
      const dt = await el.getAttribute("datetime");
      const text = ((await el.textContent()) ?? "").trim();

      expect(dt, "datetime attribute must be a valid ISO-8601 timestamp").toMatch(ISO_TIMESTAMP);
      expect(text, "visible text must not be empty after hydration").not.toBe("");
      // Post-hydration, the visible text is the locale-formatted string, not
      // the bare YYYY-MM-DD slice that the server rendered.
      expect(
        text,
        "visible text should be locale-formatted, not the SSR ISO-date fallback",
      ).not.toBe((dt ?? "").slice(0, 10));
    }

    const hydrationErrors = consoleErrors.filter((m) => /hydrat/i.test(m));
    expect(hydrationErrors, "no React hydration warnings should fire").toEqual([]);
  });

  test("same timestamp renders differently in different viewer timezones", async ({ browser }) => {
    // Sign in once in each context, capture the first <time> element's
    // dateTime attr + visible text, and assert that the *visible* text
    // differs between two distant timezones for the same (or near-same) UTC
    // instant. This is the canonical proof that FormattedDate honors the
    // viewer's TZ.
    type Sample = { dateTime: string; visible: string; localized: string };
    const samples: Array<{ tz: string } & Sample> = [];

    for (const tz of ["America/Los_Angeles", "Asia/Tokyo"]) {
      const ctx = await browser.newContext({ timezoneId: tz, locale: "en-US" });
      const page = await ctx.newPage();

      await signInAdmin(page);
      await page.goto("/admin/users");
      await waitForFormattedDateHydration(page);

      const first = page.locator("time[datetime]").first();
      const dateTime = (await first.getAttribute("datetime")) ?? "";
      const visible = ((await first.textContent()) ?? "").trim();

      // Independent computation of what FormattedDate *should* produce in
      // this context's TZ — proves the visible string was produced by
      // toLocaleString in the configured TZ, not by some other path. The
      // toLocaleString call runs *inside the browser via page.evaluate*, not
      // in Node, so the FormattedDate ESLint rule (which exists to prevent
      // server-side TZ leaks) does not apply here.
      const localized = await page.evaluate(
        // eslint-disable-next-line no-restricted-syntax
        (iso) => new Date(iso).toLocaleString(),
        dateTime,
      );

      samples.push({ tz, dateTime, visible, localized });
      await ctx.close();
    }

    // Each context's visible text must match what toLocaleString produces
    // in that context's TZ.
    for (const s of samples) {
      expect(
        s.visible,
        `${s.tz}: visible text must equal toLocaleString() in this TZ`,
      ).toBe(s.localized);
    }

    // The two TZs are >15h apart. For any real UTC instant the locale-
    // formatted string differs across them — that's the bug class this
    // primitive exists to prevent.
    expect(
      samples[0]!.visible,
      "PT and JST must render the same UTC timestamp as different visible strings",
    ).not.toBe(samples[1]!.visible);
  });
});
