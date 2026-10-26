import { NextResponse } from "next/server";
import { checkDeveloperApiRequest } from "../guard";
import {
  buildSchemaDocs,
  buildPermissionDocs,
  loadDescriptions,
  INVARIANTS,
} from "@/lib/dev-docs";

/**
 * Machine-readable twin of /developer/data-model.
 *
 * Generated from the same source as the HTML page, so the two cannot disagree.
 * Structure only, never data. Same gate as the page, answered as JSON because a
 * route handler cannot redirect a program to a sign-in page.
 *
 * Statuses, checked in this order (DECISION-258). The first two are defense in
 * depth: the proxy challenges a signed-out or unverified browser first, so only
 * a caller that bypasses the Edge reaches them.
 *   401 unauthorized          no session
 *   403 two_factor_required   a second factor is required and not verified
 *   503 unavailable           the access check or the schema read failed
 *   403 forbidden             signed in, not entitled
 *   200                       the payload
 * Every response is `no-store`.
 */
const NO_STORE = { "cache-control": "no-store" } as const;

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function GET() {
  const verdict = await checkDeveloperApiRequest();
  if (verdict === "signed_out") return fail("unauthorized", 401);
  if (verdict === "two_factor_required") return fail("two_factor_required", 403);
  if (verdict === "unavailable") return fail("unavailable", 503);
  if (verdict === "forbidden") return fail("forbidden", 403);

  let tables;
  try {
    // Same source as the HTML page, descriptions included.
    tables = buildSchemaDocs(await loadDescriptions());
  } catch {
    return fail("unavailable", 503);
  }

  return NextResponse.json(
    {
      generatedFrom: "src/lib/db/schema",
      designDoc: "docs/schema-design.md",
      counts: {
        tables: tables.length,
        tenantScoped: tables.filter((t) => t.tenantScoped).length,
      },
      invariants: INVARIANTS,
      permissions: buildPermissionDocs(),
      tables,
    },
    { headers: NO_STORE },
  );
}
