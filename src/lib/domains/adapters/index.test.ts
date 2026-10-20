/**
 * Provider selection (Phase 2 R7): which hosting provider and which probe a
 * given environment gets. The point of most of these cases is what must NEVER
 * happen: a real Vercel call from a Preview deployment or a test, or a fake in
 * production.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FakeHosting, FakeProbe } from "./fake";
import { MisconfiguredHosting, UnconfiguredHosting } from "./hosting";
import { getAdapters, resetAdaptersForTests } from "./index";
import { HttpsProbe } from "./probe";
import { VercelHosting } from "./vercel";

const VERCEL_ENV_OK = {
  DOMAINS_PROVIDER: "vercel",
  VERCEL_API_TOKEN: "tok_test_not_real",
  VERCEL_PROJECT_ID: "prj_test",
};

afterEach(() => resetAdaptersForTests());

describe("hosting provider selection", () => {
  it("unset, empty, 'unconfigured' and anything unrecognised are UNCONFIGURED (honest 'unavailable', never a guess)", () => {
    for (const value of [undefined, "", "unconfigured", "VERCEL", "vercel ", "aws", "true"]) {
      expect(getAdapters({ DOMAINS_PROVIDER: value }).hosting, String(value)).toBeInstanceOf(UnconfiguredHosting);
    }
  });

  it("'vercel' with a token and a project, outside Preview and test, is the Vercel adapter", () => {
    expect(getAdapters({ ...VERCEL_ENV_OK }).hosting).toBeInstanceOf(VercelHosting);
    expect(getAdapters({ ...VERCEL_ENV_OK, VERCEL_ENV: "production", NODE_ENV: "production" }).hosting).toBeInstanceOf(VercelHosting);
    expect(getAdapters({ ...VERCEL_ENV_OK, VERCEL_TEAM_ID: "team_test" }).hosting).toBeInstanceOf(VercelHosting);
  });

  it("'vercel' is NOT honoured on a Preview or Development deployment (a preview must not attach production domains)", () => {
    for (const vercelEnv of ["preview", "development"]) {
      expect(getAdapters({ ...VERCEL_ENV_OK, VERCEL_ENV: vercelEnv }).hosting, vercelEnv).toBeInstanceOf(UnconfiguredHosting);
    }
  });

  it("'vercel' is NOT honoured under NODE_ENV=test (no test reaches the real API however .env.local reads)", () => {
    expect(getAdapters({ ...VERCEL_ENV_OK, NODE_ENV: "test" }).hosting).toBeInstanceOf(UnconfiguredHosting);
  });

  it("'vercel' with a missing token or project is a CONFIG ERROR for the operator, not silent 'unconfigured'", async () => {
    const noToken = getAdapters({ DOMAINS_PROVIDER: "vercel", VERCEL_PROJECT_ID: "prj_test" }).hosting;
    expect(noToken).toBeInstanceOf(MisconfiguredHosting);
    expect(await noToken.addDomain("church-one.invalid")).toEqual({ kind: "config_error", reason: "token_invalid" });
    const noProject = getAdapters({ DOMAINS_PROVIDER: "vercel", VERCEL_API_TOKEN: "tok_test_not_real" }).hosting;
    expect(await noProject.addDomain("church-one.invalid")).toEqual({ kind: "config_error", reason: "project_missing" });
    expect(await noProject.removeDomain("church-one.invalid")).toEqual({ kind: "config_error", reason: "project_missing" });
  });

  it("'fake' is the in-memory fake outside production, memoised so attach state persists across calls", () => {
    const a = getAdapters({ DOMAINS_PROVIDER: "fake", NODE_ENV: "test" });
    const b = getAdapters({ DOMAINS_PROVIDER: "fake", NODE_ENV: "test" });
    expect(a.hosting).toBeInstanceOf(FakeHosting);
    expect(a.hosting).toBe(b.hosting);
    expect(a.probe).toBeInstanceOf(FakeProbe);
    expect(a.probe).toBe(b.probe);
  });

  it("'fake' in production (either signal) is ignored: unconfigured, and never a fake probe", () => {
    for (const env of [{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }]) {
      const a = getAdapters({ DOMAINS_PROVIDER: "fake", ...env });
      expect(a.hosting).toBeInstanceOf(UnconfiguredHosting);
      expect(a.probe).toBeInstanceOf(HttpsProbe);
    }
  });

  it("the unconfigured provider answers 'unavailable' to everything, so the lifecycle waits honestly", async () => {
    const h = new UnconfiguredHosting();
    expect(await h.addDomain()).toEqual({ kind: "retryable", reason: "unavailable" });
    expect(await h.getDomain()).toEqual({ kind: "retryable", reason: "unavailable" });
    expect(await h.verifyDomain()).toEqual({ kind: "retryable", reason: "unavailable" });
    expect(await h.getConfig()).toEqual({ kind: "unavailable", reason: "unavailable" });
    expect(await h.removeDomain()).toEqual({ kind: "retryable", reason: "unavailable" });
  });
});

describe("probe selection and overrides", () => {
  it("the real probe is built on whichever DNS observer is in force, so an injected resolver can never fall back to real DoH", () => {
    const dns = { lookup: vi.fn() } as never;
    const a = getAdapters({}, { dns });
    expect(a.dns).toBe(dns);
    expect(a.probe).toBeInstanceOf(HttpsProbe);
  });

  it("an override wins over the environment", () => {
    const hosting = new FakeHosting();
    const probe = new FakeProbe();
    const a = getAdapters({ ...VERCEL_ENV_OK }, { hosting, probe });
    expect(a.hosting).toBe(hosting);
    expect(a.probe).toBe(probe);
  });
});
