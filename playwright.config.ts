import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, ".env.local") });

/**
 * True only when `npm run visual:baseline` / `npm run visual:check` set
 * `PW_VISUAL=1`. Plain `playwright test` (what `npm run test:e2e` runs) does
 * not set it, so this is false there.
 *
 * The `visual` project is included in `projects` ONLY when this is true. That
 * is what keeps it out of a bare `playwright test` run: Playwright runs every
 * project in the array by default when no `--project` filter is given, so a
 * project that is merely testMatch-narrowed would still execute on a plain
 * `npm run test:e2e`. Omitting it from the array entirely is the only
 * guarantee that holds regardless of Playwright's default project-selection
 * behavior.
 *
 * NOT `process.argv` — tried first and reverted. Playwright's test WORKERS
 * are separate processes that reload this config file to resolve which
 * project they belong to, and their argv does not carry the CLI's
 * `--project=visual` flag (they errored "Project \"visual\" not found in the
 * worker process"). Environment variables, unlike argv, are inherited by a
 * spawned child process, which is why this works where the argv check did
 * not. See docs/work-log/2026-08-19-brand-foundation.md, commit `a2`.
 */
const isVisualRun = process.env.PW_VISUAL === "1";

export default defineConfig({
  globalSetup: "./e2e/support/global-setup.ts",
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  // Starts the dev server automatically. Locally, reuseExistingServer means an
  // already-running `npm run dev` is used as-is (no more two-terminal dance);
  // in CI a fresh server is required so stale processes can't mask failures.
  webServer: {
    command: "npm run dev",
    url: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Credentials sign-in is limited to 5/min per ip:email (src/auth.ts). The
      // suite signs the same fixture in far more often than that, and a rate-
      // limited attempt returns null — surfacing as "Wrong email or password"
      // with failed_login_attempts untouched, which reads exactly like a bad
      // password. Disable the limiter for the server this config starts.
      //
      // NOTE: this does NOT reach a dev server that was already running and got
      // reused. globalSetup checks for that case and fails with instructions.
      RATE_LIMIT_DISABLED: "true",
    },
  },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // The visual project owns visual-parity.spec.ts's per-route viewport /
      // colorScheme matrix via test.use(); running it here too would collide
      // with that spec's own storageState/viewport overrides for no benefit.
      testIgnore: /visual-parity\.spec\.ts$/,
    },
    ...(isVisualRun
      ? [
          {
            name: "visual",
            use: { ...devices["Desktop Chrome"] },
            testMatch: /visual-parity\.spec\.ts$/,
            // Gitignored (.gitignore), self-comparing baselines only — see
            // e2e/visual-parity.spec.ts's header. {arg} carries the name
            // passed to toHaveScreenshot(); no {platform} or {projectName}
            // token, because these baselines are never committed or compared
            // across machines.
            snapshotPathTemplate: "{testDir}/.visual/{arg}{ext}",
          },
        ]
      : []),
  ],
});
