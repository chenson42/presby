/**
 * Unit tests for the pre-push gate: the command matcher (whose false-positive
 * classes were discovered live), the shell lexer, and `decideHook`, the gate's
 * whole decision as a pure function. Nothing here writes the real marker
 * (.claude/pre-push-ok.json); the one hook-mode spawn only READS it and
 * asserts its bytes are unchanged.
 *
 * Run via: npm test
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  commandContainsGitPush,
  resolvePushTargetRepoRoot,
  analyzeGitInvocations,
  decideHook,
  HEAD_MOVERS,
} from "./pre-push-gate.mjs";

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

// ── Lexer-backed matching (commit 1 of 2026-10-25-retro-workflow-efficiency) ─

const HOUSE_COMMIT = [
  'git commit -m "$(cat <<\'EOF\'',
  "fix(hooks): refuse a chained commit and push",
  "",
  "A chained git commit && git push was not refused.",
  "git push is refused now, and a \"quoted\" word is fine.",
  "",
  "Co-Authored-By: Someone <noreply@example.invalid>",
  "EOF",
  ')"',
].join("\n");

describe("commandContainsGitPush › quoting", () => {
  it("a commit message about a chained push is text, not a push", () => {
    expect(
      commandContainsGitPush('git commit -m "a chained git commit && git push is refused"'),
    ).toBe(false);
  });

  it("the house heredoc-in-$()-in-quotes commit message is not a push", () => {
    expect(commandContainsGitPush(HOUSE_COMMIT)).toBe(false);
  });

  it("git commit -F - with a heredoc body that has a push line is not a push", () => {
    expect(
      commandContainsGitPush("git commit -F - <<'EOF'\nmsg\ngit push is refused\nEOF\n"),
    ).toBe(false);
  });

  it("a comment is not a command", () => {
    expect(commandContainsGitPush("git status # then git push")).toBe(false);
  });

  it("single-quoted text is literal", () => {
    expect(commandContainsGitPush("echo 'x; git push'")).toBe(false);
  });

  it("a here-string is not a heredoc", () => {
    expect(commandContainsGitPush("cat <<< 'git push'\ngit status")).toBe(false);
  });

  it("a push inside a double-quoted $() runs, so it counts", () => {
    expect(commandContainsGitPush('echo "$(git push)"')).toBe(true);
  });

  it("a push inside backticks runs, so it counts", () => {
    expect(commandContainsGitPush("echo `git push`")).toBe(true);
  });
});

describe("commandContainsGitPush › wrapped forms", () => {
  it.each([
    ['bash -c "git commit -m x && git push"'],
    ["sh -c 'git push origin main'"],
    ["bash -lc 'git push'"],
    ['eval "git push"'],
    ["(git commit -m x; git push)"],
    ["{ git status; git push; }"],
    ["command git push"],
    ["/usr/bin/git push origin main"],
    ["env GIT_X=1 git push"],
    ["FOO=1 git push"],
    ["time git push"],
    ["bash <<'EOF'\ngit push\nEOF\n"],
    ["git -C /somewhere -c user.name=x push"],
  ])("sees the push in %s", (cmd) => {
    expect(commandContainsGitPush(cmd)).toBe(true);
  });
});

describe("analyzeGitInvocations", () => {
  it("tracks cd and git -C into an absolute directory", () => {
    const inv = analyzeGitInvocations("cd sub && git -C inner status && git push", "/r");
    expect(inv.map((g) => [g.sub, g.dir])).toEqual([
      ["status", "/r/sub/inner"],
      ["push", "/r/sub"],
    ]);
    expect(inv.map((g) => g.index)).toEqual([0, 1]);
  });

  it("HEAD_MOVERS is the closed set", () => {
    expect([...HEAD_MOVERS].sort()).toEqual(
      ["am", "cherry-pick", "commit", "merge", "pull", "rebase", "reset", "revert"].sort(),
    );
  });
});

describe("decideHook › chained", () => {
  const base = { cwd: REPO_ROOT, repoRoot: REPO_ROOT, head: "aaaaaaaaaa", toplevelOf: () => REPO_ROOT };
  const fresh = { head: "aaaaaaaaaa" };
  const decide = (command, extra = {}) => decideHook({ ...base, marker: fresh, command, ...extra });

  it.each([
    ["git commit -m x && git push", "commit"],
    ["git commit -m x; git push", "commit"],
    ["git commit -m x\ngit push", "commit"],
    ["git commit -m x || git push", "commit"],
    ['bash -c "git commit -m x && git push"', "commit"],
    ['eval "git commit -m x && git push"', "commit"],
    ["(git commit -m x; git push)", "commit"],
    ["git pull --ff-only && git push", "pull"],
    ["git merge main && git push", "merge"],
    ["git rebase main && git push", "rebase"],
    ["git cherry-pick abc && git push", "cherry-pick"],
    ["git am x.patch && git push", "am"],
    ["git revert abc && git push", "revert"],
    ["git reset --soft HEAD~1 && git push", "reset"],
    [HOUSE_COMMIT + " && git push", "commit"],
  ])("refuses %j even with a fresh marker", (command, sub) => {
    const d = decide(command);
    expect(d.exit).toBe(2);
    expect(d.message).toContain("BLOCKED (Workflow Rule 5): this command moves HEAD and pushes in one call.");
    expect(d.message).toContain("Commit first, run /pre-push, then push in a separate call.");
    expect(d.message).toContain(`Found: git ${sub} before git push.`);
  });

  it("allows a push followed by a commit, and a lone push with a fresh marker", () => {
    expect(decide("git push && git commit -m x")).toEqual({ exit: 0 });
    expect(decide("git push origin main")).toEqual({ exit: 0 });
  });

  it("allows a command with no push", () => {
    expect(decide("git commit -m x", { marker: null })).toEqual({ exit: 0 });
  });

  it("keeps the missing and stale marker messages", () => {
    expect(decide("git push", { marker: null }).message).toContain("no pre-push marker found");
    expect(decide("git push", { marker: { head: "bbbbbbbbbb" } }).message).toContain(
      "pre-push marker is stale",
    );
  });

  it("allows when git is unavailable (head null)", () => {
    expect(decide("git push", { head: null, marker: null })).toEqual({ exit: 0 });
  });
});

describe("decideHook › target repo", () => {
  const scratch = "/elsewhere/scratch/x";
  const toplevelOf = (dir) => (dir.startsWith("/elsewhere") ? scratch : REPO_ROOT);
  const base = { cwd: REPO_ROOT, repoRoot: REPO_ROOT, head: "aaaaaaaaaa", toplevelOf };
  const fresh = { head: "aaaaaaaaaa" };

  it("mover and push both in another repository: exit 0, marker not consulted", () => {
    const d = decideHook({
      ...base,
      marker: null,
      command: "cd /elsewhere/scratch/x && git commit -m x && git push",
    });
    expect(d).toEqual({ exit: 0 });
  });

  it("mover in this repository and push elsewhere: exit 0", () => {
    const d = decideHook({
      ...base,
      marker: null,
      command: "git commit -m x && git -C /elsewhere/scratch/x push",
    });
    expect(d).toEqual({ exit: 0 });
  });

  it("mover elsewhere and push here reaches the marker check, not the chained refusal", () => {
    const d = decideHook({
      ...base,
      marker: null,
      command: "git -C /elsewhere/scratch/x commit -m x && git push",
    });
    expect(d.exit).toBe(2);
    expect(d.message).toContain("no pre-push marker found");
    const ok = decideHook({
      ...base,
      marker: fresh,
      command: "git -C /elsewhere/scratch/x commit -m x && git push",
    });
    expect(ok).toEqual({ exit: 0 });
  });

  it("undeterminable target (null) is gated, including the chained refusal", () => {
    const d = decideHook({
      ...base,
      marker: fresh,
      toplevelOf: () => null,
      command: "git commit -m x && git push",
    });
    expect(d.exit).toBe(2);
    expect(d.message).toContain("moves HEAD and pushes");
  });
});

describe("decideHook › fail-open", () => {
  const base = { cwd: REPO_ROOT, repoRoot: REPO_ROOT, head: "aaaaaaaaaa", marker: { head: "aaaaaaaaaa" }, toplevelOf: () => REPO_ROOT };

  it.each([
    ["unterminated double quote", 'git commit -m "oops'],
    ["unterminated single quote", "git commit -m 'oops"],
    ["lone $(", 'echo "$('],
    ["unterminated heredoc", "cat <<EOF\nnever ends"],
    ["NUL byte", "git status\0git push"],
    ["20 nested bash -c", "x".replace("x", Array.from({ length: 20 }).reduce((acc) => `bash -c ${JSON.stringify(acc)}`, "git push"))],
    ["100 KB of (", "(".repeat(100_000)],
    ["empty", ""],
  ])("%s never throws and returns a decision", (_n, command) => {
    const d = decideHook({ ...base, command });
    expect([0, 2]).toContain(d.exit);
  });

  it("nesting beyond depth 6 fails open (accepted residual)", () => {
    const deep = Array.from({ length: 20 }).reduce((acc) => `bash -c ${JSON.stringify(acc)}`, "git commit -m x && git push");
    expect(decideHook({ ...base, command: deep })).toEqual({ exit: 0 });
  });

  it("an exception inside the analysis fails open", () => {
    const d = decideHook({ ...base, command: "git push", toplevelOf: () => { throw new Error("boom"); } });
    expect(d).toEqual({ exit: 0 });
  });
});

// ACCEPTED RESIDUALS, pinned. These assert what the gate does TODAY and document
// that it is a known gap (see ACCEPTED RESIDUALS in scripts/pre-push-gate.mjs),
// not that the behaviour is right. Remove a test here only when the gate is
// changed to catch the case.
describe("commandContainsGitPush › accepted residuals", () => {
  const base = { cwd: REPO_ROOT, repoRoot: REPO_ROOT, head: "aaaaaaaaaa", toplevelOf: () => REPO_ROOT };
  const fresh = { head: "aaaaaaaaaa" };

  it("an unquoted $() is ordered after its enclosing command: the commit is not seen before the push", () => {
    // accepted residual: remove this test only when the gate is changed to catch it
    const command = "git push $(git commit -m x)";
    expect(commandContainsGitPush(command)).toBe(true);
    expect(decideHook({ ...base, marker: fresh, command })).toEqual({ exit: 0 });
    // the marker check still applies to the push itself
    expect(decideHook({ ...base, marker: null, command }).exit).toBe(2);
  });

  it.each(["nice -n 5 git push", "time -p git push", "command -p git push"])(
    "a prefix with a flag of its own hides the push: %j is not seen",
    (command) => {
      // accepted residual: remove this test only when the gate is changed to catch it
      expect(commandContainsGitPush(command)).toBe(false);
      expect(decideHook({ ...base, marker: null, command })).toEqual({ exit: 0 });
    },
  );

  it("the same prefixes with no flags are followed (the control)", () => {
    for (const command of ["nice git push", "time git push", "command git push"]) {
      expect(commandContainsGitPush(command)).toBe(true);
      expect(decideHook({ ...base, marker: null, command }).exit).toBe(2);
    }
  });
});

describe("hook mode (spawn, read-only)", () => {
  it("refuses a chained commit and push and leaves the real marker byte-for-byte alone", () => {
    const markerPath = path.join(REPO_ROOT, ".claude", "pre-push-ok.json");
    const before = existsSync(markerPath) ? readFileSync(markerPath) : null;
    const r = spawnSync("node", [path.join(REPO_ROOT, "scripts", "pre-push-gate.mjs")], {
      input: JSON.stringify({
        tool_input: { command: "git commit -m x && git push" },
        cwd: REPO_ROOT,
      }),
      encoding: "utf8",
    });
    const after = existsSync(markerPath) ? readFileSync(markerPath) : null;
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("BLOCKED (Workflow Rule 5): this command moves HEAD and pushes in one call.");
    expect(after === null ? null : after.toString("hex")).toBe(before === null ? null : before.toString("hex"));
  });

  it("allows a non-push command", () => {
    const r = spawnSync("node", [path.join(REPO_ROOT, "scripts", "pre-push-gate.mjs")], {
      input: JSON.stringify({ tool_input: { command: "git status" }, cwd: REPO_ROOT }),
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
  });
});
