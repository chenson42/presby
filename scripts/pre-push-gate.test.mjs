/**
 * Unit tests for the pre-push gate's push detection.
 * Marker/HEAD gating is exercised by invoking the script as a hook (integration
 * territory); these tests pin the command matcher, whose false-positive classes
 * were both discovered live (see commandContainsGitPush doc comment).
 *
 * Run via: npm test
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { commandContainsGitPush, resolvePushTargetRepoRoot } from "./pre-push-gate.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

describe("commandContainsGitPush", () => {
  // ── Pushes that must be caught ─────────────────────────────────────────────

  it("plain push", () => {
    expect(commandContainsGitPush("git push origin main")).toBe(true);
  });

  it("push with flags", () => {
    expect(commandContainsGitPush("git push --force-with-lease origin feature/x")).toBe(true);
  });

  it("push after && in a compound command", () => {
    expect(commandContainsGitPush("cd /repo && git push")).toBe(true);
  });

  it("push with -C path (value-consuming global flag)", () => {
    expect(commandContainsGitPush("git -C /repo push origin main")).toBe(true);
  });

  it("push with boolean global flag", () => {
    expect(commandContainsGitPush("git --no-pager push")).toBe(true);
  });

  // ── Non-pushes that must pass through ──────────────────────────────────────

  it("git status", () => {
    expect(commandContainsGitPush("git status")).toBe(false);
  });

  it("echo merely mentioning git push", () => {
    expect(commandContainsGitPush("echo git push is mentioned here")).toBe(false);
  });

  it("grep for the phrase", () => {
    expect(commandContainsGitPush("grep -rn 'git push' docs/")).toBe(false);
  });

  it("git log --grep=push (push not the subcommand)", () => {
    expect(commandContainsGitPush("git log --grep=push --oneline")).toBe(false);
  });

  it('commit message mentioning "pre-push" (hyphen is a word boundary)', () => {
    expect(commandContainsGitPush('git commit -m "feat(dx): add pre-push gate"')).toBe(false);
  });

  it("empty command", () => {
    expect(commandContainsGitPush("")).toBe(false);
  });
});

describe("resolvePushTargetRepoRoot", () => {
  it("plain push from this repo's own root resolves to this repo", () => {
    expect(resolvePushTargetRepoRoot("git push origin main", REPO_ROOT)).toBe(REPO_ROOT);
  });

  it("plain push from a subdirectory of this repo still resolves to this repo", () => {
    expect(resolvePushTargetRepoRoot("git push", path.join(REPO_ROOT, "scripts"))).toBe(
      REPO_ROOT,
    );
  });

  it("cd into an unrelated directory, then push, resolves relative to that directory", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { execFileSync } = await import("node:child_process");
    const os = await import("node:os");
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pre-push-gate-test-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: tmp });
      const resolved = resolvePushTargetRepoRoot(`cd ${tmp} && git push origin main`, REPO_ROOT);
      // macOS's /tmp is a symlink to /private/tmp — resolve both sides.
      const { realpathSync } = await import("node:fs");
      expect(resolved).toBe(realpathSync(tmp));
      expect(resolved).not.toBe(REPO_ROOT);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("inline git -C <path> on the push segment overrides the tracked cwd", async () => {
    const { mkdtempSync, rmSync, realpathSync } = await import("node:fs");
    const { execFileSync } = await import("node:child_process");
    const os = await import("node:os");
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pre-push-gate-test-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: tmp });
      const resolved = resolvePushTargetRepoRoot(`git -C ${tmp} push origin main`, REPO_ROOT);
      expect(resolved).toBe(realpathSync(tmp));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("cd to a nonexistent path returns null (undeterminable, not falsely ungated)", () => {
    expect(
      resolvePushTargetRepoRoot(
        "cd /nonexistent/path/for/this/test && git push",
        REPO_ROOT,
      ),
    ).toBe(null);
  });

  it("no push in the command returns null (never called for a non-push, but shouldn't throw)", () => {
    expect(resolvePushTargetRepoRoot("git status", REPO_ROOT)).toBe(null);
  });
});
