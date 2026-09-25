/**
 * Regression for QA Phase 5 Advisory 1 — the token hash reaching server
 * logs on `submitStatisticsGrant()`'s unexpected-error path.
 *
 * `docs/work-log/2026-09-25-submission-grants.md` Phase 5: QA measured that
 * `console.error("...", err)` on an unmapped SQLSTATE prints Drizzle's own
 * `DrizzleQueryError` message verbatim — `Failed query: ...\nparams: <hash>,
 * ...` — because `presby_submit_granted_return`'s first bound parameter is
 * the sha256 token hash. Fixed by logging only `{ code }`, never the caught
 * error object or the joined `.message` chain `pgErrorInfo()` extracts from
 * it (which is built FROM that same Drizzle message).
 *
 * MOCKED, not DB-backed — this file fabricates the exact error shape QA
 * reproduced (a `DrizzleQueryError`-lookalike whose own `.message` embeds
 * the bound token hash) rather than trying to provoke a genuine unmapped
 * SQLSTATE from a live Postgres connection. `src/lib/statistics-grants.test.ts`
 * (DB-backed) is a separate file and is not touched here — mocking `@/lib/db`
 * there would break its real-connection tests.
 */

vi.mock("server-only", () => ({}));
// `./statistics-grants` -> `@/lib/email` -> `@/lib/email/queue.ts` ->
// `@/lib/audit` -> `@/auth`, which loads next-auth -> next/server: not
// resolvable under plain Vitest Node.js — same fact documented in
// `statistics-grants.test.ts` and `password-reset-actions.test.ts`.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const mockDbExecute = vi.hoisted(() => vi.fn());
const mockFindFirst = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({
  db: {
    execute: (...args: unknown[]) => mockDbExecute(...args),
    query: {
      statisticsSubmissionGrants: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
  },
  getPlatformDb: vi.fn(),
}));

// `@/lib/db/domain/*` is NOT mocked — it is pure Drizzle table-schema code
// (no DB connection, no env-var read at import time), and mocking one of
// these files with an incomplete stub breaks every OTHER domain module that
// imports additional named exports from the same physical path (measured:
// `@/lib/db/schema`'s barrel pulls in the full domain graph transitively via
// `@/lib/authz`).

const mockIsFlagEnabled = vi.hoisted(() => vi.fn());
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => mockIsFlagEnabled(...args),
}));

vi.mock("@/lib/email", () => ({
  enqueueEmail: vi.fn(),
  escapeHtml: (value: string) => value,
}));

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitStatisticsGrant } from "./statistics-grants";

const RAW_TOKEN = "raw-token-for-the-log-redaction-regression-test";
const TOKEN_HASH = createHash("sha256").update(RAW_TOKEN).digest("hex");
const HEX64_RE = /[0-9a-f]{64}/i;

/** Same shape QA measured: an unmapped SQLSTATE nested under `.cause`, and
 *  the outer error's own `.message` — the one Drizzle actually builds —
 *  embeds the bound query parameters, hash included. */
class FakeCause extends Error {
  code = "55000"; // deliberately unmapped by submitStatisticsGrant's catch
}
class FakeDrizzleQueryError extends Error {
  constructor(hash: string) {
    super(
      `Failed query: select presby_submit_granted_return($1, $2::jsonb, $3, $4)\n` +
        `params: ${hash},"{}",Jane Clerk,clerk_of_session`,
    );
    this.cause = new FakeCause("some unexpected database error");
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsFlagEnabled.mockResolvedValue(true);
  mockDbExecute.mockRejectedValue(new FakeDrizzleQueryError(TOKEN_HASH));
});

/**
 * `JSON.stringify(new Error("x"))` yields `{}` — Node/V8 defines `message`
 * as a non-enumerable own property, so a naive `JSON.stringify` scan of the
 * logged call args would silently pass even when the buggy code logs the
 * raw error object (verified: this is exactly what made an earlier draft of
 * this test a false negative). A real log line — whether Node's own
 * `console.error` formatter or an aggregator using `util.inspect` — DOES
 * surface `.message` and `.cause`, so this helper walks the same chain
 * `pgErrorInfo()` walks in the production code, to scan what actually ends
 * up on the wire.
 */
function serializeLoggedArgsForScan(callArgs: unknown[][]): string {
  return callArgs
    .flat()
    .map((arg) => {
      if (arg instanceof Error) {
        const messages: string[] = [];
        let current: unknown = arg;
        for (let depth = 0; depth < 6 && current instanceof Error; depth += 1) {
          messages.push(current.message);
          current = (current as { cause?: unknown }).cause;
        }
        return messages.join(" :: ");
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" | ");
}

describe("submitStatisticsGrant — unexpected-error log redaction", () => {
  it("never logs the token hash, even when the driver error's own message embeds it", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await submitStatisticsGrant(
        RAW_TOKEN,
        {},
        "Jane Clerk",
        "clerk_of_session",
      );
      expect(result.kind).toBe("invalid");

      const serialized = serializeLoggedArgsForScan(errorSpy.mock.calls);

      expect(serialized).not.toContain(TOKEN_HASH);
      // Stronger, cause-agnostic guard: a sha256 hex hash is always exactly
      // 64 lowercase hex characters — assert none appear anywhere in the
      // logged output at all, not just this specific test's hash.
      expect(serialized).not.toMatch(HEX64_RE);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("still logs SOMETHING useful for debugging — the SQLSTATE code", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await submitStatisticsGrant(RAW_TOKEN, {}, "Jane Clerk", "clerk_of_session");

      expect(errorSpy).toHaveBeenCalledWith(
        "[statistics-grants] submitStatisticsGrant: unexpected error",
        { code: "55000" },
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
