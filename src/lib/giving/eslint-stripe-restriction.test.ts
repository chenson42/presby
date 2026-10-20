/**
 * Pins the `stripe` import restriction in eslint.config.mjs (R8 / Phase 2 S1):
 * the SDK is imported at runtime by exactly one file, the allowlist client.
 * Runs the real ESLint with the real config over in-memory snippets, so a
 * future edit to the config that quietly loosens the rule fails here. The same
 * property is enforced independently, tree-wide, by
 * scripts/check-giving-boundaries.mjs (B1/B2).
 */
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const eslint = new ESLint({ cwd: ROOT });

async function restrictedImportMessages(code: string, relPath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, relPath) });
  return (result?.messages ?? [])
    .filter((m) => /no-restricted-imports/.test(m.ruleId ?? ""))
    .map((m) => `${m.ruleId}: ${m.message}`);
}

const RUNTIME = 'import Stripe from "stripe";\nexport const s = Stripe;\n';
const TYPE_ONLY = 'import type Stripe from "stripe";\nexport type S = Stripe;\n';
const SUBPATH = 'import Core from "stripe/cjs/stripe.core.js";\nexport const c = Core;\n';

describe("eslint: the stripe import restriction", () => {
  it("restricts a runtime import in an ordinary lib file, a route and a component", async () => {
    for (const file of [
      "src/lib/giving/donors.ts",
      "src/app/api/webhooks/stripe/route.ts",
      "src/components/giving/give-form.tsx",
    ]) {
      const messages = await restrictedImportMessages(RUNTIME, file);
      expect(messages, file).toHaveLength(1);
      expect(messages[0], file).toContain("client.ts");
    }
  }, 30_000);

  it("restricts a sub-path import (stripe/*) the same way", async () => {
    expect(await restrictedImportMessages(SUBPATH, "src/lib/giving/donors.ts")).toHaveLength(1);
  }, 30_000);

  it("restricts a TYPE-only import outside the provider folder (the core knows no provider's types)", async () => {
    expect(await restrictedImportMessages(TYPE_ONLY, "src/lib/giving/types.ts")).toHaveLength(1);
  }, 30_000);

  it("allows a type-only import inside src/lib/giving/providers/stripe/", async () => {
    expect(
      await restrictedImportMessages(TYPE_ONLY, "src/lib/giving/providers/stripe/normalize.ts"),
    ).toEqual([]);
  }, 30_000);

  it("restricts a RUNTIME import in a sibling of client.ts inside the provider folder", async () => {
    expect(
      await restrictedImportMessages(RUNTIME, "src/lib/giving/providers/stripe/normalize.ts"),
    ).toHaveLength(1);
  }, 30_000);

  it("allows the runtime import in client.ts, and in a provider-folder test", async () => {
    expect(
      await restrictedImportMessages(RUNTIME, "src/lib/giving/providers/stripe/client.ts"),
    ).toEqual([]);
    expect(
      await restrictedImportMessages(RUNTIME, "src/lib/giving/providers/stripe/client.test.ts"),
    ).toEqual([]);
  }, 30_000);
});
