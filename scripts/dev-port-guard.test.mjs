/**
 * Unit tests for the Playwright dev-lane guard (e2e/support/dev-port-guard.ts).
 * Rule 16 says a pipeline never attaches to :3000 (a run that did is
 * discarded); three QA runs were discarded or contaminated before this was
 * mechanical. The guard must throw only for linked worktree + loopback 3000 +
 * no PW_ALLOW_3000 + not CI, and must never throw for the main checkout, CI,
 * an unreadable git, or an unparsable URL.
 *
 * Run via: npm test
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveDevPort,
  isLinkedWorktree,
  devLaneGuardMessage,
  assertDevLaneAllowed,
} from "../e2e/support/dev-port-guard.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("resolveDevPort", () => {
  it.each([
    ["http://localhost:3000", 3000, "http://localhost:3000", true],
    ["http://localhost", 80, "http://localhost", true],
    ["https://localhost", 443, "https://localhost", true],
    ["http://127.0.0.1:3000", 3000, "http://127.0.0.1:3000", true],
    ["http://[::1]:3000", 3000, "http://[::1]:3000", true],
    ["http://0.0.0.0:3000", 3000, "http://0.0.0.0:3000", true],
    ["http://localhost:3480", 3480, "http://localhost:3480", true],
    ["http://staging.example:3000", 3000, "http://staging.example:3000", false],
  ])("%s", (url, port, origin, loopback) => {
    expect(resolveDevPort(url)).toEqual({ port, origin, loopback });
  });

  it("defaults to http://localhost:3000 when unset", () => {
    expect(resolveDevPort(undefined)).toEqual({
      port: 3000,
      origin: "http://localhost:3000",
      loopback: true,
    });
  });

  it("returns null for garbage rather than throwing", () => {
    expect(resolveDevPort("not a url")).toBe(null);
    expect(resolveDevPort("")).toBe(null);
  });
});

describe("devLaneGuardMessage", () => {
  const worktree = () => true;
  const mainCheckout = () => false;
  const opts = (over = {}) => ({
    baseUrl: undefined,
    projectDir: ROOT,
    env: {},
    isWorktree: worktree,
    ...over,
  });

  it("refuses a linked worktree on the default port", () => {
    const m = devLaneGuardMessage(opts());
    expect(m).not.toBe(null);
  });

  it("the message names the origin, the remedy and the escape hatch", () => {
    const m = devLaneGuardMessage(opts({ baseUrl: "http://127.0.0.1:3000" }));
    expect(m).toContain("Refusing to run Playwright from a linked git worktree against http://127.0.0.1:3000 (port 3000).");
    expect(m).toContain("E2E_BASE_URL");
    expect(m).toContain('docs/testing.md, "Running Playwright from a worktree"');
    expect(m).toContain("To use port 3000 anyway, set PW_ALLOW_3000=1.");
  });

  it("does not refuse the main checkout", () => {
    expect(devLaneGuardMessage(opts({ isWorktree: mainCheckout }))).toBe(null);
  });

  it("does not refuse in CI", () => {
    expect(devLaneGuardMessage(opts({ env: { CI: "1" } }))).toBe(null);
  });

  it("PW_ALLOW_3000=1 allows; 0 and true do not", () => {
    expect(devLaneGuardMessage(opts({ env: { PW_ALLOW_3000: "1" } }))).toBe(null);
    expect(devLaneGuardMessage(opts({ env: { PW_ALLOW_3000: "0" } }))).not.toBe(null);
    expect(devLaneGuardMessage(opts({ env: { PW_ALLOW_3000: "true" } }))).not.toBe(null);
  });

  it("allows an assigned port", () => {
    expect(devLaneGuardMessage(opts({ baseUrl: "http://localhost:3480" }))).toBe(null);
  });

  it("allows a non-loopback host on 3000", () => {
    expect(devLaneGuardMessage(opts({ baseUrl: "http://staging.example:3000" }))).toBe(null);
  });

  it("http://localhost (port 80) is not port 3000", () => {
    expect(devLaneGuardMessage(opts({ baseUrl: "http://localhost" }))).toBe(null);
  });

  it("an unparsable URL does not throw and is not refused", () => {
    expect(devLaneGuardMessage(opts({ baseUrl: "garbage" }))).toBe(null);
  });
});

describe("assertDevLaneAllowed", () => {
  it("throws the refusal for a worktree on 3000", () => {
    expect(() =>
      assertDevLaneAllowed({ baseUrl: undefined, projectDir: ROOT, env: {}, isWorktree: () => true }),
    ).toThrow(/Refusing to run Playwright from a linked git worktree/);
  });

  it("does not throw for the main checkout, CI, PW_ALLOW_3000=1 or port 3480", () => {
    const base = { baseUrl: undefined, projectDir: ROOT, env: {}, isWorktree: () => true };
    expect(() => assertDevLaneAllowed({ ...base, isWorktree: () => false })).not.toThrow();
    expect(() => assertDevLaneAllowed({ ...base, env: { CI: "true" } })).not.toThrow();
    expect(() => assertDevLaneAllowed({ ...base, env: { PW_ALLOW_3000: "1" } })).not.toThrow();
    expect(() => assertDevLaneAllowed({ ...base, baseUrl: "http://localhost:3480" })).not.toThrow();
  });
});

describe("isLinkedWorktree", () => {
  it("treats a failing git as the main checkout (never throws)", () => {
    const failing = () => {
      throw new Error("git: command not found");
    };
    expect(isLinkedWorktree("/nowhere", failing)).toBe(false);
  });

  it("is true when git-dir differs from git-common-dir, false when they match", () => {
    const linked = (args) => (args.includes("--git-dir") ? "/m/.git/worktrees/w" : "/m/.git");
    const main = () => ".git";
    expect(isLinkedWorktree("/m/w", linked)).toBe(true);
    expect(isLinkedWorktree("/m", main)).toBe(false);
  });

  it("agrees with real git on a temp repo and its linked worktree", () => {
    const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "dev-port-guard-")));
    const git = (args, cwd) =>
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
      });
    try {
      const main = path.join(tmp, "main");
      const linked = path.join(tmp, "linked");
      git(["init", "-q", main], tmp);
      git(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "--allow-empty", "-m", "init"], main);
      git(["worktree", "add", "-q", "-b", "wt", linked], main);
      expect(isLinkedWorktree(main)).toBe(false);
      expect(isLinkedWorktree(linked)).toBe(true);
      expect(isLinkedWorktree(path.join(tmp, "not-a-repo"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("playwright.config.ts wiring", () => {
  it("calls assertDevLaneAllowed inside the non-production-lane branch", () => {
    const src = readFileSync(path.join(ROOT, "playwright.config.ts"), "utf8");
    expect(src).toMatch(/if \(!isProdBuildRun\) \{\s*assertDevLaneAllowed\(/);
  });
});
