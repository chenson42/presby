/**
 * Drift guard for AGENTS.md. `next dev` (Next 16) rewrites the managed block
 * between the nextjs-agent-rules markers whenever it differs from the form
 * its own generator writes, which dirtied the tree in every worktree where a
 * dev server started under an agent. The file is committed in the generator's
 * own form; this test fails after a Next upgrade changes that form, with the
 * one-line remedy, instead of the tree silently going dirty again.
 *
 * Run via: npm test
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(import.meta.url);

describe("AGENTS.md", () => {
  it("matches the block this version of Next writes on next dev", () => {
    let mod;
    try {
      mod = require("next/dist/server/lib/generate-agent-files");
    } catch {
      throw new Error(
        "Next no longer exports generate-agent-files at this path; update scripts/agents-md.test.mjs.",
      );
    }
    if (typeof mod.hasCurrentAgentRules !== "function") {
      throw new Error(
        "Next no longer exports generate-agent-files at this path; update scripts/agents-md.test.mjs.",
      );
    }
    if (!mod.hasCurrentAgentRules(REPO_ROOT)) {
      throw new Error(
        "AGENTS.md does not match the block this version of Next writes on next dev. " +
          "Run: node -e \"require('next/dist/server/lib/generate-agent-files').writeAgentFiles('.')\" and commit AGENTS.md.",
      );
    }
    expect(mod.hasCurrentAgentRules(REPO_ROOT)).toBe(true);
  });
});
