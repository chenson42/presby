/**
 * Unit tests for the report-only disk and worktree script. It prints and
 * deletes nothing; the tests pin the parsing, the quoting of the suggested
 * commands, the four-fact worktree state (own commits / all on origin/main /
 * clean / named branch), the rule that `git worktree remove` is suggested ONLY
 * for a merged, clean worktree, the 20 GiB line, the exact report strings, that
 * the main checkout never gets a state or a suggestion, and (against real
 * temporary git repositories) the 2026-10-25 incident: a brand-new pipeline
 * worktree, holding only ignored files, must never be offered for removal.
 *
 * Run via: npm test
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseWorktreePorcelain,
  shellQuote,
  worktreeState,
  worktreeFacts,
  buildModel,
  removalSuggestions,
  formatReport,
  LOW_DISK_GIB,
} from "./worktree-report.mjs";

const PORCELAIN = [
  "worktree /w/presby",
  "HEAD 1111111111111111111111111111111111111111",
  "branch refs/heads/main",
  "",
  "worktree /w/presby-wf",
  "HEAD 2222222222222222222222222222222222222222",
  "branch refs/heads/pipeline/retro-workflow-efficiency",
  "",
  "worktree /w/presby detached",
  "HEAD 3333333333333333333333333333333333333333",
  "detached",
  "",
  "worktree /w/bare.git",
  "bare",
  "",
].join("\n");

describe("parseWorktreePorcelain", () => {
  const entries = parseWorktreePorcelain(PORCELAIN);

  it("reads every entry, the first being the main checkout", () => {
    expect(entries.map((e) => e.path)).toEqual(["/w/presby", "/w/presby-wf", "/w/presby detached", "/w/bare.git"]);
    expect(entries[0].isMain).toBe(true);
    expect(entries.slice(1).every((e) => !e.isMain)).toBe(true);
  });

  it("strips refs/heads/ from a branch", () => {
    expect(entries[0].branch).toBe("main");
    expect(entries[1].branch).toBe("pipeline/retro-workflow-efficiency");
  });

  it("marks a detached HEAD and a bare entry", () => {
    expect(entries[2]).toMatchObject({ detached: true, branch: null, head: "3333333333333333333333333333333333333333" });
    expect(entries[3]).toMatchObject({ bare: true, head: null });
  });

  it("returns an empty list for empty output", () => {
    expect(parseWorktreePorcelain("")).toEqual([]);
  });
});

describe("shellQuote", () => {
  it("single-quotes a path with a space", () => {
    expect(shellQuote("/w/a b")).toBe("'/w/a b'");
  });

  it("escapes a single quote inside the path", () => {
    expect(shellQuote("/w/it's")).toBe("'/w/it'\\''s'");
  });

  it("leaves no way to inject a command", () => {
    expect(shellQuote("/w/x; rm -rf ~")).toBe("'/w/x; rm -rf ~'");
    expect(shellQuote("$(whoami)")).toBe("'$(whoami)'");
  });
});

describe("worktreeState › truth table", () => {
  const table = [
    // [facts, expected]
    [{ detached: true, ancestor: true, onFirstParent: false }, null],
    [{ detached: true, ancestor: false, onFirstParent: false }, null],
    [{ detached: false, ancestor: null, onFirstParent: null }, null],
    [{ detached: false, ancestor: null, onFirstParent: true }, null],
    [{ detached: false, ancestor: false, onFirstParent: false }, "unmerged"],
    [{ detached: false, ancestor: false, onFirstParent: null }, "unmerged"],
    [{ detached: false, ancestor: true, onFirstParent: null }, null],
    [{ detached: false, ancestor: true, onFirstParent: true }, "none"],
    [{ detached: false, ancestor: true, onFirstParent: false }, "merged"],
  ];
  it.each(table)("%j gives %j", (facts, expected) => {
    expect(worktreeState(facts)).toBe(expected);
  });
});

describe("removalSuggestions › table", () => {
  const base = { path: "/w/x", isMain: false, bare: false, state: "merged", dirty: false, nextExists: false };
  const out = (over) => removalSuggestions([{ ...base, ...over }]);

  it("a merged and clean worktree gets git worktree remove", () => {
    expect(out({})).toEqual(["git worktree remove '/w/x'"]);
  });

  it("a merged but dirty worktree gets no remove", () => {
    expect(out({ dirty: true })).toEqual([]);
  });

  it("a merged worktree whose dirtiness is unknown gets no remove", () => {
    expect(out({ dirty: null })).toEqual([]);
  });

  it.each(["none", "unmerged", null])("state %j gets no remove, even when clean", (state) => {
    expect(out({ state, dirty: false }).some((l) => l.startsWith("git worktree remove"))).toBe(false);
  });

  it("offers the .next removal only when .next exists", () => {
    expect(out({ state: "unmerged", nextExists: false })).toEqual([]);
    expect(out({ state: "unmerged", nextExists: true })).toEqual(["rm -rf '/w/x/.next'"]);
  });

  it("a merged, clean worktree with a .next gets both", () => {
    expect(out({ nextExists: true })).toEqual(["git worktree remove '/w/x'", "rm -rf '/w/x/.next'"]);
  });

  it("quotes a path with a space or a single quote", () => {
    expect(out({ path: "/w/a b" })).toEqual(["git worktree remove '/w/a b'"]);
    expect(out({ path: "/w/it's", nextExists: true })).toContain("rm -rf '/w/it'\\''s/.next'");
  });

  it("the main checkout and a bare entry never appear", () => {
    expect(out({ isMain: true, nextExists: true })).toEqual([]);
    expect(out({ bare: true, nextExists: true })).toEqual([]);
  });
});

describe("formatReport › exact strings", () => {
  const wt = (over) => ({
    path: "/w/x", branch: "pipeline/x", detached: false, isMain: false, bare: false,
    state: "merged", dirty: false, nextExists: false, sizes: null, ...over,
  });
  const model = (over = {}, worktrees = [wt({})]) => ({
    repoRoot: "/w/presby",
    freeGiB: 100,
    baseFound: true,
    worktrees: [wt({ path: "/w/presby", branch: "main", isMain: true, state: null, dirty: null }), ...worktrees],
    ...over,
  });
  const FOOTER =
    'Hardlinked node_modules are counted in full for each worktree. "merged into origin/main" means the branch has commits of its own and every one of them is on origin/main as of your last fetch. A branch that was squash-merged or fast-forwarded cannot be told from an unmerged or an unused one, so no worktree removal is suggested for it. This report deletes nothing.';

  it("says OK at or above 20 GiB", () => {
    expect(LOW_DISK_GIB).toBe(20);
    expect(formatReport(model({ freeGiB: 541.2 }))).toContain(
      "Disk: 541.2 GiB free on the volume holding /w/presby (checklist minimum 20 GiB: OK)",
    );
  });

  it("flags the low-disk case with the ENOSPC warning", () => {
    expect(formatReport(model({ freeGiB: 1.9 }))).toContain(
      'Disk: 1.9 GiB free on the volume holding /w/presby: BELOW the 20 GiB the new-feature checklist asks for. A full disk has surfaced as a Neon "fetch failed" before; free space before running suites.',
    );
  });

  it("labels each state exactly", () => {
    const text = formatReport(
      model({}, [
        wt({ path: "/w/a", state: "merged" }),
        wt({ path: "/w/b", state: "none" }),
        wt({ path: "/w/c", state: "unmerged" }),
      ]),
    );
    expect(text).toContain("\n/w/a  pipeline/x  merged into origin/main\n");
    expect(text).toContain("\n/w/b  pipeline/x  no commits of its own (new or unused)\n");
    expect(text).toContain("\n/w/c  pipeline/x  not merged\n");
  });

  it("omits the state for the main checkout, a bare entry, a detached HEAD and an unknown state", () => {
    const text = formatReport(
      model({}, [
        wt({ path: "/w/bare.git", branch: null, bare: true, state: null, dirty: null }),
        wt({ path: "/w/det", branch: null, detached: true, state: null }),
        wt({ path: "/w/unk", branch: null, state: null }),
      ]),
    );
    expect(text).toContain("\n/w/presby  main\n");
    expect(text).toContain("\n/w/bare.git  bare\n");
    expect(text).toContain("\n/w/det  detached\n");
    expect(text).toContain("\n/w/unk  unknown\n");
  });

  it("shows the changes label only for a dirty worktree", () => {
    const text = formatReport(
      model({}, [wt({ path: "/w/d", state: "unmerged", dirty: true }), wt({ path: "/w/c", state: "unmerged", dirty: false })]),
    );
    expect(text).toContain("\n/w/d  pipeline/x  not merged  uncommitted or untracked files\n");
    expect(text).toContain("\n/w/c  pipeline/x  not merged\n");
  });

  it("prints sizes as the last segment, and omits them when skipped", () => {
    const sized = model({}, [wt({ path: "/w/s", state: "unmerged", dirty: true, sizes: { nodeModules: 2, next: 0.1, rest: 0.05 } })]);
    expect(formatReport(sized)).toContain(
      "/w/s  pipeline/x  not merged  uncommitted or untracked files  node_modules 2.0 GiB, .next 0.1 GiB, rest 0.1 GiB",
    );
    expect(formatReport(model())).not.toContain(", .next ");
  });

  it("carries the hardlink, squash, fast-forward and deletes-nothing footer", () => {
    expect(formatReport(model())).toContain(`\n\n${FOOTER}`);
  });

  it("says merge state is not shown when origin/main is missing, and only then", () => {
    const line = "Merge state is not shown: origin/main was not found in this repository.";
    expect(formatReport(model({ baseFound: false }))).toContain(line);
    expect(formatReport(model())).not.toContain(line);
  });

  describe("suggestion headers", () => {
    const REMOVE_NOTE =
      '"git worktree remove" also deletes the ignored files in that worktree, such as .env.local and node_modules; the branch is kept.';
    const NEXT_NOTE = '".next" is regenerable; stop that worktree\'s dev server before removing it.';
    const HEAD = "Suggestions for you to run (nothing here has been run):";

    it("prints no header and no commands when there is nothing to suggest", () => {
      const text = formatReport(model({}, [wt({ state: "unmerged" })]));
      expect(text).not.toContain(HEAD);
      expect(text).not.toContain(REMOVE_NOTE);
      expect(text).not.toContain(NEXT_NOTE);
    });

    it("a removal alone prints the header, the ignored-files note and the command, in that order", () => {
      const text = formatReport(model());
      expect(text).toContain(`\n\n${HEAD}\n${REMOVE_NOTE}\n  git worktree remove '/w/x'`);
      expect(text).not.toContain(NEXT_NOTE);
    });

    it(".next alone prints the regenerable note and not the ignored-files note", () => {
      const text = formatReport(model({}, [wt({ state: "unmerged", nextExists: true })]));
      expect(text).toContain(`\n\n${HEAD}\n${NEXT_NOTE}\n  rm -rf '/w/x/.next'`);
      expect(text).not.toContain(REMOVE_NOTE);
    });

    it("both kinds print both notes, the commands after them", () => {
      const text = formatReport(model({}, [wt({ nextExists: true })]));
      expect(text).toContain(`${HEAD}\n${REMOVE_NOTE}\n${NEXT_NOTE}\n  git worktree remove '/w/x'\n  rm -rf '/w/x/.next'`);
    });
  });
});

// ── Real temporary git repositories ──────────────────────────────────────────
// The incident: a brand-new pipeline worktree has HEAD at a commit main already
// contains, so "HEAD is an ancestor of origin/main" was true and the report
// offered `git worktree remove` for it. These run the real gatherers.

describe("buildModel and worktreeFacts against real repositories", () => {
  const roots = [];
  const savedEnv = {};
  const ENV = {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.invalid",
  };

  beforeAll(() => {
    for (const k of Object.keys(ENV)) {
      savedEnv[k] = process.env[k];
      process.env[k] = ENV[k]; // the script's own git calls inherit these: no user config leaks in
    }
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  /** A repo with one commit on main, origin/main standing at it, and the usual ignores. */
  function makeRepo() {
    const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "worktree-report-")));
    roots.push(tmp);
    const main = path.join(tmp, "main");
    git(["init", "-q", "-b", "main", main], tmp);
    writeFileSync(path.join(main, ".gitignore"), ".env.local\nnode_modules/\n.next/\n");
    git(["add", "."], main);
    git(["commit", "-q", "-m", "init"], main);
    git(["update-ref", "refs/remotes/origin/main", "HEAD"], main); // stands in for a fetch
    return {
      tmp,
      main,
      addWorktree(name, extra = [], commitish = []) {
        const wt = path.join(tmp, name);
        git(["worktree", "add", "-q", ...extra, wt, ...commitish], main);
        return wt;
      },
      commitIn(dir, file) {
        writeFileSync(path.join(dir, file), `${file}\n`);
        git(["add", file], dir);
        git(["commit", "-q", "-m", `add ${file}`], dir);
      },
      publish() {
        git(["update-ref", "refs/remotes/origin/main", "main"], main);
      },
    };
  }

  /** Only ignored files, as `.env.local` and `node_modules/` are in a real pipeline worktree. */
  function addIgnored(wt) {
    writeFileSync(path.join(wt, ".env.local"), "X=1\n");
    mkdirSync(path.join(wt, "node_modules"));
    writeFileSync(path.join(wt, "node_modules", "pkg.js"), "x\n");
  }

  const entry = (model, p) => model.worktrees.find((w) => w.path === p);
  const report = (repo) => formatReport(buildModel(repo.main, { sizes: false }));
  const removeLines = (text) => text.split("\n").filter((l) => /git worktree remove/.test(l) && l.startsWith("  "));

  it("fresh worktree with only ignored files: state none, clean, never offered for removal (the incident)", () => {
    const r = makeRepo();
    const wt = r.addWorktree("fresh", ["-b", "fresh"]);
    addIgnored(wt);
    const model = buildModel(r.main, { sizes: false });
    expect(entry(model, wt)).toMatchObject({ state: "none", dirty: false, branch: "fresh" });
    const text = formatReport(model);
    expect(removeLines(text)).toEqual([]);
    expect(text).toContain("no commits of its own (new or unused)");
    expect(text).not.toMatch(/ {2}merged into origin\/main/); // the footer quotes the phrase; no worktree line may carry it
    expect(text).not.toContain("Suggestions for you to run");
  });

  it("fresh worktree plus an untracked work-log file: dirty", () => {
    const r = makeRepo();
    const wt = r.addWorktree("fresh", ["-b", "fresh"]);
    addIgnored(wt);
    writeFileSync(path.join(wt, "2026-10-25-x.md"), "log\n");
    const model = buildModel(r.main, { sizes: false });
    expect(entry(model, wt)).toMatchObject({ state: "none", dirty: true });
    expect(formatReport(model)).toContain("uncommitted or untracked files");
  });

  it("merged by a merge commit and clean: offered for removal with the ignored-files note", () => {
    const r = makeRepo();
    const wt = r.addWorktree("feat", ["-b", "feat"]);
    r.commitIn(wt, "feat.txt");
    git(["merge", "-q", "--no-ff", "-m", "Merge pull request #1", "feat"], r.main);
    r.publish();
    addIgnored(wt);
    const model = buildModel(r.main, { sizes: false });
    expect(entry(model, wt)).toMatchObject({ state: "merged", dirty: false });
    const text = formatReport(model);
    expect(removeLines(text)).toEqual([`  git worktree remove '${wt}'`]);
    expect(text).toContain("merged into origin/main");
    expect(text).toContain("also deletes the ignored files in that worktree");
  });

  it("merged but dirty: no remove line; a .next removal only if .next exists", () => {
    const r = makeRepo();
    const wt = r.addWorktree("feat", ["-b", "feat"]);
    r.commitIn(wt, "feat.txt");
    git(["merge", "-q", "--no-ff", "-m", "Merge pull request #1", "feat"], r.main);
    r.publish();
    writeFileSync(path.join(wt, "stray.md"), "x\n");
    let model = buildModel(r.main, { sizes: false });
    expect(entry(model, wt)).toMatchObject({ state: "merged", dirty: true, nextExists: false });
    let text = formatReport(model);
    expect(removeLines(text)).toEqual([]);
    expect(text).not.toContain("rm -rf");
    mkdirSync(path.join(wt, ".next"));
    model = buildModel(r.main, { sizes: false });
    expect(entry(model, wt).nextExists).toBe(true);
    text = formatReport(model);
    expect(removeLines(text)).toEqual([]);
    expect(text).toContain(`  rm -rf '${wt}/.next'`);
  });

  it("a branch with its own unmerged commit: unmerged, no remove line", () => {
    const r = makeRepo();
    const wt = r.addWorktree("open", ["-b", "open"]);
    r.commitIn(wt, "open.txt");
    const model = buildModel(r.main, { sizes: false });
    expect(entry(model, wt)).toMatchObject({ state: "unmerged", dirty: false });
    expect(removeLines(formatReport(model))).toEqual([]);
  });

  it("fast-forwarded into main reads none; squash-merged reads unmerged; neither is offered", () => {
    const r = makeRepo();
    const ff = r.addWorktree("ff", ["-b", "ff"]);
    r.commitIn(ff, "ff.txt");
    git(["merge", "-q", "--ff-only", "ff"], r.main);
    const sq = r.addWorktree("sq", ["-b", "sq"]);
    r.commitIn(sq, "sq.txt");
    git(["merge", "-q", "--squash", "sq"], r.main);
    git(["commit", "-q", "-m", "squash sq"], r.main);
    r.publish();
    const model = buildModel(r.main, { sizes: false });
    expect(entry(model, ff).state).toBe("none");
    expect(entry(model, sq).state).toBe("unmerged");
    expect(removeLines(formatReport(model))).toEqual([]);
  });

  it("a detached worktree has no state and is never offered, whatever its ancestry", () => {
    const r = makeRepo();
    const feat = r.addWorktree("feat", ["-b", "feat"]);
    r.commitIn(feat, "feat.txt");
    git(["merge", "-q", "--no-ff", "-m", "Merge pull request #1", "feat"], r.main);
    r.publish();
    const tip = git(["rev-parse", "feat"], r.main);
    const det = r.addWorktree("det", ["--detach"], [tip]);
    const model = buildModel(r.main, { sizes: false });
    expect(entry(model, det)).toMatchObject({ detached: true, state: null, dirty: false });
    expect(removeLines(formatReport(model)).filter((l) => l.includes(det))).toEqual([]);
    expect(removeLines(formatReport(model)).filter((l) => l.includes(feat))).toHaveLength(1); // the control: the merged branch is offered
  });

  it("no origin/main: baseFound is false, every state is null, nothing is offered, and the report says so", () => {
    const r = makeRepo();
    const feat = r.addWorktree("feat", ["-b", "feat"]);
    r.commitIn(feat, "feat.txt");
    git(["merge", "-q", "--no-ff", "-m", "Merge pull request #1", "feat"], r.main);
    git(["update-ref", "-d", "refs/remotes/origin/main"], r.main);
    const model = buildModel(r.main, { sizes: false });
    expect(model.baseFound).toBe(false);
    expect(model.worktrees.every((w) => w.state === null)).toBe(true);
    const text = formatReport(model);
    expect(removeLines(text)).toEqual([]);
    expect(text).toContain("Merge state is not shown: origin/main was not found in this repository.");
  });

  it("does not fall back to a local main when origin/main is missing", () => {
    const r = makeRepo();
    git(["update-ref", "-d", "refs/remotes/origin/main"], r.main);
    const wt = r.addWorktree("fresh", ["-b", "fresh"]);
    expect(entry(buildModel(r.main, { sizes: false }), wt).state).toBeNull();
  });

  it("the main checkout never gets a state, a dirty flag or a suggestion", () => {
    const r = makeRepo();
    writeFileSync(path.join(r.main, "stray.md"), "x\n");
    mkdirSync(path.join(r.main, ".next"));
    const model = buildModel(r.main, { sizes: false });
    expect(model.worktrees[0]).toMatchObject({ path: r.main, isMain: true, state: null, dirty: null });
    expect(formatReport(model)).not.toContain("rm -rf");
    expect(removalSuggestions(model.worktrees)).toEqual([]);
  });

  it("worktreeFacts reads ancestor and first-parent membership from git", () => {
    const r = makeRepo();
    const feat = r.addWorktree("feat", ["-b", "feat"]);
    r.commitIn(feat, "feat.txt");
    git(["merge", "-q", "--no-ff", "-m", "Merge pull request #1", "feat"], r.main);
    r.publish();
    const base = git(["rev-parse", "origin/main"], r.main);
    const line = new Set(git(["rev-list", "--first-parent", base], r.main).split("\n"));
    const featTip = git(["rev-parse", "feat"], r.main);
    expect(worktreeFacts(featTip, base, line, r.main)).toEqual({ ancestor: true, onFirstParent: false });
    expect(worktreeFacts(base, base, line, r.main)).toEqual({ ancestor: true, onFirstParent: true });
    expect(worktreeFacts("0".repeat(40), base, line, r.main).ancestor).toBeNull();
  });
});

describe("worktree-report › reads and never writes", () => {
  const src = readFileSync(new URL("./worktree-report.mjs", import.meta.url), "utf8");
  const calls = [...src.matchAll(/\bgitRun\(\s*\[([^\]]*)\]/g)].map((m) => m[1]);

  it("finds the git calls (the scan is not vacuous)", () => {
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });

  it("spawns git in exactly one place, and that place is the read-only helper", () => {
    expect(src.match(/execFileSync\(\s*"git"/g)).toHaveLength(1);
  });

  it("every git call names a read-only subcommand", () => {
    const allowed = [/^"worktree",\s*"list"/, /^"rev-parse"/, /^"rev-list"/, /^"merge-base"/, /^"status"/];
    for (const c of calls) {
      const args = c.replace(/^\s*"--no-optional-locks",\s*/, "");
      expect(allowed.some((re) => re.test(args.trim())), `unexpected git call: [${c}]`).toBe(true);
    }
  });

  it("every status call carries --no-optional-locks (it must not refresh an index)", () => {
    const statuses = calls.filter((c) => /"status"/.test(c));
    expect(statuses.length).toBeGreaterThan(0);
    for (const c of statuses) expect(c).toMatch(/^\s*"--no-optional-locks",/);
  });

  it("no git call names a mutating subcommand", () => {
    const banned = /"(remove|prune|clean|checkout|switch|reset|rm|mv|add|commit|merge|fetch|pull|push|gc|update-ref)"/;
    for (const c of calls) expect(c, `mutating git call: [${c}]`).not.toMatch(banned);
  });
});
