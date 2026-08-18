/**
 * Unit tests for the pre-push gate's push detection.
 * Marker/HEAD gating is exercised by invoking the script as a hook (integration
 * territory); these tests pin the command matcher, whose false-positive classes
 * were both discovered live (see commandContainsGitPush doc comment).
 *
 * Run via: npm test
 */
import { describe, it, expect } from "vitest";
import { commandContainsGitPush } from "./pre-push-gate.mjs";

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
