import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, ".env.local") });

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
    },
  ],
});
