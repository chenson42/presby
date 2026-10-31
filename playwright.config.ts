import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import dotenv from "dotenv";
import { assertDevLaneAllowed } from "./e2e/support/dev-port-guard";

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

/**
 * True only when `npm run test:e2e:prod` sets `PW_PROD_BUILD=1` (DECISION-159).
 * Environment variable, NOT argv, for the same reason as `isVisualRun`: workers
 * reload this file and do not inherit the CLI's flags. The throws below
 * therefore re-run harmlessly in each worker.
 *
 * The lane runs the hydration specs (`e2e/hydration/`) against a PRODUCTION
 * build (`next build && next start`) on its own port, because a Turbopack dev
 * server's hydration window is far wider than a real user's and proves little.
 * A dev server must never be able to satisfy it, hence four layers: (1)
 * `reuseExistingServer: false`, so anything already bound to the port aborts
 * the run; (2) this branch rejects `E2E_BASE_URL`, so a dev server cannot be
 * pointed at; (3) `baseURL` is a constant derived from the port; (4)
 * `assertProductionServer()` in e2e/support/global-setup.ts fingerprints the
 * HTML the server returns.
 */
const isProdBuildRun = process.env.PW_PROD_BUILD === "1";

/**
 * True only when `npm run help:shots` sets `PW_HELP_SHOTS=1` (user-help Inc 1, Batch 4). Environment
 * variable, NOT argv, for the reason `isVisualRun` gives. The `help-shots` project is appended ONLY
 * when this is true, and the `chromium` project ignores `e2e/help-shots/`, so a bare `playwright test`
 * never captures. The capture writes the PNGs under src/content/help/images/ and is never part of CI.
 * Its globalSetup runs the fail-closed fixture-database guard before anything else (see
 * e2e/help-shots/global-setup.ts).
 */
const isHelpShotsRun = process.env.PW_HELP_SHOTS === "1";
if (isHelpShotsRun && (isVisualRun || isProdBuildRun)) {
  throw new Error("PW_HELP_SHOTS=1 is mutually exclusive with PW_VISUAL=1 and PW_PROD_BUILD=1.");
}
const PROD_PORT = Number(process.env.PW_PROD_PORT ?? 3800);
const PROD_BASE_URL = `http://localhost:${PROD_PORT}`;

if (isProdBuildRun) {
  if (isVisualRun) {
    throw new Error("PW_PROD_BUILD=1 and PW_VISUAL=1 are mutually exclusive.");
  }
  if (process.env.E2E_BASE_URL) {
    throw new Error(
      "PW_PROD_BUILD=1 starts and owns its own production server and base URL; unset E2E_BASE_URL " +
        "(an external, i.e. dev, server must never satisfy this lane).",
    );
  }
  if (
    !Number.isInteger(PROD_PORT) ||
    PROD_PORT < 1024 ||
    PROD_PORT > 65535 ||
    PROD_PORT === 3000
  ) {
    throw new Error(
      `PW_PROD_PORT must be an integer 1024-65535 other than 3000 (got "${process.env.PW_PROD_PORT}").`,
    );
  }
}

// Workflow Rule 16: a pipeline never attaches to :3000. From a linked worktree
// this throws unless E2E_BASE_URL names your own port or PW_ALLOW_3000=1
// (e2e/support/dev-port-guard.ts). Covers the dev lane and the visual run; the
// production lane has its own, stricter checks above.
if (!isProdBuildRun) {
  assertDevLaneAllowed({ baseUrl: process.env.E2E_BASE_URL, projectDir: __dirname });
}

const baseURL = isProdBuildRun
  ? PROD_BASE_URL
  : (process.env.E2E_BASE_URL ?? "http://localhost:3000");

/**
 * Custom domains (Track F, docs/work-log/2026-10-19-custom-domains.md, Phase 3 "E2E approach").
 *
 * A church's own domain is exercised WITHOUT a real domain: Chromium is told to resolve every
 * `*.invalid` name to loopback (`--host-resolver-rules`), so `http://church-one.invalid:<port>/`
 * reaches the dev (or production-build) server with that name in `Host`. `.invalid` is reserved by
 * RFC 2606 and can never resolve on the public internet, and a test that needs the opposite - a
 * request that LIES about its Host - sets the header explicitly on the `request` fixture instead.
 * Non-production treats loopback as a platform host and `*.invalid` as a custom host.
 *
 * The `DOMAINS_*` variables below are test-only fakes (a Vercel production deployment refuses them
 * at build time, `assertPlatformHostConfig`). Like `RATE_LIMIT_DISABLED`, they reach only a server
 * THIS config starts; a reused dev server needs them in its own environment, and globalSetup says so.
 * The fake state file lives under the gitignored `.tmp/`.
 */
const HOST_RESOLVER_ARGS = ["--host-resolver-rules=MAP *.invalid 127.0.0.1"];
const DOMAINS_TEST_ENV = {
  DOMAINS_ALLOW_RESERVED_TLDS: "1",
  DOMAINS_PROVIDER: "fake",
  DOMAINS_DNS_PROVIDER: "fake",
  DOMAINS_FAKE_STATE_FILE: path.resolve(__dirname, ".tmp", "domains-fake-state.json"),
  // The cron pass-through specs drive /api/cron/* with this bearer (already set for the giving
  // webhook harness; a value already in the environment wins, as there).
  CRON_SECRET: process.env.CRON_SECRET ?? "giving-e2e-cron-secret",
};

export default defineConfig({
  globalSetup: isHelpShotsRun ? "./e2e/help-shots/global-setup.ts" : "./e2e/support/global-setup.ts",
  testDir: "./e2e",
  // Unset in CI and by default locally — "test-results" (the literal
  // e2e.yml's trace-upload step and .gitignore already expect). Only a
  // parallel worktree running the suite alongside another one sets this, so
  // its output doesn't collide with a sibling worktree's own test-results/.
  outputDir: process.env.PW_OUTPUT_DIR ?? "test-results",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // A GitHub runner talking to a remote Neon branch under `next dev` renders a
  // revalidated page several times slower than a developer machine (the first
  // CI run took 40 min for what takes ~15 locally; giving-connect's post-action
  // re-render was still "Rendering..." at 5 s). Only the assertion budget is
  // widened, and only in CI: a locally-slow assertion should still be loud.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  reporter: [["list"]],
  // Starts the dev server automatically. Locally, reuseExistingServer means an
  // already-running `npm run dev` is used as-is (no more two-terminal dance);
  // in CI a fresh server is required so stale processes can't mask failures.
  webServer: isProdBuildRun
    ? {
        command: `npm run build && npm run start -- --port ${PROD_PORT}`,
        // Always 200; the same endpoint globalSetup uses.
        url: `${PROD_BASE_URL}/api/auth/csrf`,
        // ALWAYS, CI or not: an existing server on this port must abort the run.
        reuseExistingServer: false,
        // Covers the build (~16 s warm locally; allow a cold CI Turbopack build).
        timeout: 600_000,
        // The default is "ignore": a failing build must be visible in the reporter.
        stdout: "pipe",
        stderr: "pipe",
        env: {
          RATE_LIMIT_DISABLED: "true",
          // Overrides the AUTH_URL=http://localhost:3000 that CI writes to
          // .env.local; Auth.js rewrites request origins to AUTH_URL.
          AUTH_URL: PROD_BASE_URL,
          ...DOMAINS_TEST_ENV,
        },
      }
    : {
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
          // The signed-event replay harness (e2e/giving-webhook.spec.ts) signs
          // fixture bodies with this value and POSTs them to the real webhook
          // route. NON-key-shaped literals: the Stripe SDK only needs HMAC bytes,
          // and a key-shaped string in a public repository is a check:secrets
          // finding. A value already in the environment wins, so a developer can
          // point the spec at a server started with its own.
          STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? "giving-e2e-signing-secret",
          // CRON_SECRET (in DOMAINS_TEST_ENV): the same spec drives GET /api/cron/giving to retry a
          // parked event, and the custom-domain specs drive the proxy's cron pass-through.
          ...DOMAINS_TEST_ENV,
        },
      },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: isProdBuildRun
    ? [
        {
          name: "prod-build",
          use: { ...devices["Desktop Chrome"] },
          // The hydration specs, plus help-404.spec.ts: the help 404 must be `no-store` with no
          // cache entry per URL, and only a production build can prove that (a dev server sends
          // no-store on everything). DECISION-293.
          testMatch: /(hydration\/.*|help-404)\.spec\.ts$/,
        },
        // The custom-domain specs that must hold on a PRODUCTION build too: the HSTS host split
        // (`headers()` is baked into the routes manifest at build time), the lockdown / no-cookie
        // matrix, the serving matrix and the public asset allowlist (F289: an exact single
        // `x-content-type-options: nosniff` is a property of the built server, not the dev one).
        // `npm run test:e2e:prod` runs both projects.
        {
          name: "prod-custom-hosts",
          use: { ...devices["Desktop Chrome"], launchOptions: { args: HOST_RESOLVER_ARGS } },
          testMatch: /custom-domains\/(assets|headers|lockdown|serving)\.spec\.ts$/,
        },
      ]
    : [
        {
          name: "chromium",
          use: { ...devices["Desktop Chrome"] },
          // The visual project owns visual-parity.spec.ts's per-route viewport /
          // colorScheme matrix via test.use(); running it here too would collide
          // with that spec's own storageState/viewport overrides for no benefit.
          testIgnore: [/visual-parity\.spec\.ts$/, /custom-domains\//, /help-shots\//],
        },
        // Custom domains (see HOST_RESOLVER_ARGS above). The first test of the first spec is a
        // CANARY proving the `*.invalid` mapping works, so every later failure is real.
        {
          name: "custom-hosts",
          use: { ...devices["Desktop Chrome"], launchOptions: { args: HOST_RESOLVER_ARGS } },
          testMatch: /custom-domains\/.*\.spec\.ts$/,
        },
        ...(isHelpShotsRun
          ? [
              {
                name: "help-shots",
                // The scheme, reduced motion, scale factor and viewport are fixed per shot in the spec.
                use: { ...devices["Desktop Chrome"], colorScheme: "light" as const },
                testMatch: /help-shots\/capture\.spec\.ts$/,
              },
            ]
          : []),
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
