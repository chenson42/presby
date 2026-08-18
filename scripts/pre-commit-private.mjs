#!/usr/bin/env node
/**
 * pre-commit guard: nothing under private/ may ever be committed.
 *
 * This repository is public. `.gitignore` alone is not a control — `git add -f`
 * overrides it, some tooling stages ignored paths, and an agent running
 * `git add -A` in a hurry is exactly the failure mode. So the rule is enforced
 * twice: ignored by .gitignore, and hard-blocked here at the point of commit.
 *
 * The cautionary tale is westervillelions' docs/reviews/2026-08-12-pii-scrub.md:
 * 9 personal addresses across ~73 occurrences, and the expensive part was not
 * the app code but migrations, one-off scripts, and work-logs. Prevention is
 * cheap; a scrub is not, and git history keeps the original anyway.
 *
 * Also blocks a short list of obviously-secret filenames wherever they appear.
 */
import { execSync } from "node:child_process";

const BLOCKED_PREFIXES = ["private/", "scratch/"];
const BLOCKED_NAMES = [
  ".env",
  ".env.local",
  ".env.production",
  "id_rsa",
  "id_ed25519",
  "service-account.json",
];

let staged = "";
try {
  staged = execSync("git diff --cached --name-only --diff-filter=ACMR", {
    encoding: "utf8",
  });
} catch {
  process.exit(0); // no commit in progress, or no HEAD yet
}

const files = staged.split("\n").filter(Boolean);

const offenders = files.filter(
  (f) =>
    BLOCKED_PREFIXES.some((p) => f === p.slice(0, -1) || f.startsWith(p)) ||
    BLOCKED_NAMES.includes(f.split("/").pop()),
);

if (offenders.length > 0) {
  console.error("\nCOMMIT BLOCKED — these paths must never enter a public repo:\n");
  for (const f of offenders) console.error(`  ${f}`);
  console.error(
    "\nprivate/ and scratch/ are for real congregation data, exports, and\n" +
      "credentials. They are gitignored AND blocked here on purpose.\n" +
      "\nIf something in there belongs in the repo, it needs to be synthetic\n" +
      "first — see scripts/seed-dev.sql for the house style.\n",
  );
  process.exit(1);
}
