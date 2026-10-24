/**
 * Helpers for the zod characterization ("golden") tests that pin what a user
 * sees from validation: docs/work-log/2026-10-23-zod-4.md, Phase 3 "Tests".
 *
 * Test-only: never imported by app code. Expected values in the golden files
 * are written inline from the source's own message strings, never snapshots.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldErrors as RhfErrors, FieldValues } from "react-hook-form";

export type FlatMessages = Record<string, string>;

/** RHF's nested errors object flattened to `{ "donor.donorId": "message" }`. */
function flatten(errors: RhfErrors, prefix = "", out: FlatMessages = {}): FlatMessages {
  for (const [key, value] of Object.entries(errors as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const node = value as { message?: unknown; type?: unknown; ref?: unknown };
    if (typeof node.message === "string" && typeof node.type === "string") {
      out[path] = node.message;
    } else {
      flatten(value as RhfErrors, path, out);
    }
  }
  return out;
}

/**
 * Runs the real `zodResolver` (what every react-hook-form form calls) and
 * returns the parsed values plus the flattened first message per dotted path.
 * Because it goes through the resolver, the same assertions cover whichever
 * zod major the resolver is driving.
 */
export async function resolveForm(
  // The resolver is typed against RHF's generics; tests hand it any schema.
  schema: any,
  values: unknown,
): Promise<{ values: unknown; errors: FlatMessages; failed: boolean }> {
  const result = await zodResolver(schema)(values as FieldValues, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  });
  const errors = flatten(result.errors as RhfErrors);
  return { values: result.values, errors, failed: Object.keys(errors).length > 0 };
}

/** Same as `resolveForm`, for schemas that must succeed. */
export async function resolveOk(
  schema: any,
  values: unknown,
): Promise<unknown> {
  const out = await resolveForm(schema, values);
  expectNoErrors(out.errors);
  return out.values;
}

function expectNoErrors(errors: FlatMessages): void {
  const keys = Object.keys(errors);
  if (keys.length > 0) {
    throw new Error(`expected a clean parse, got: ${JSON.stringify(errors)}`);
  }
}

/** `issues[0]?.message` — the route `filings` and `parseReason` use. */
export function firstIssueMessage(
  result: { success: true } | { success: false; error: { issues: { message: string }[] } },
): string | undefined {
  return result.success ? undefined : result.error.issues[0]?.message;
}

/** Issue paths as dotted strings, in order. */
export function issuePaths(
  result: { success: true } | { success: false; error: { issues: { path: PropertyKey[] }[] } },
): string[] {
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
}
